"""Archive Austra public HTML/PDF content and produce provenance-preserving JSON."""
import concurrent.futures as cf
import hashlib
import io
import json
import re
import time
import xml.etree.ElementTree as ET
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

BASE = 'https://austra.edu.au/'
OUT = Path('data/austra_crawl')
UA = 'AustraKnowledgeArchive/1.0 (public website content research)'
START = datetime.now(timezone.utc).isoformat()
for folder in ('raw_html', 'pdfs', 'documents', 'metadata'):
    (OUT / folder).mkdir(parents=True, exist_ok=True)

def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def normalize(url):
    p = urlsplit(url)
    if p.scheme not in ('http', 'https') or p.hostname not in ('austra.edu.au', 'www.austra.edu.au'):
        return None
    if p.path.startswith(('/wp-admin', '/wp-json', '/wp-login', '/feed')):
        return None
    if re.search(r'\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|mp4|mp3|woff2?|zip)$', p.path, re.I):
        return None
    return urlunsplit(('https', 'austra.edu.au', p.path or '/', '', ''))

def fetch(url):
    last = None
    for attempt in range(3):
        try:
            time.sleep(0.4)
            r = requests.get(url, headers={'User-Agent': UA}, timeout=(15, 60))
            if r.status_code in (429, 500, 502, 503, 504):
                r.raise_for_status()
            return r
        except requests.RequestException as e:
            last = e
            time.sleep(1 + attempt * 2)
    raise last

robots_response = fetch(urljoin(BASE, 'robots.txt'))
robots_response.raise_for_status()
(OUT / 'metadata/robots.txt').write_text(robots_response.text, encoding='utf-8')
robots = RobotFileParser()
robots.parse(robots_response.text.splitlines())
seeds = {BASE}
sitemap_errors = []
maps = deque(robots.site_maps() or [urljoin(BASE, 'sitemap_index.xml')])
seen_maps = set()
while maps:
    url = maps.popleft()
    if url in seen_maps:
        continue
    seen_maps.add(url)
    try:
        response = fetch(url)
        response.raise_for_status()
        (OUT / 'metadata' / (hashlib.sha256(url.encode()).hexdigest()[:16] + '.xml')).write_bytes(response.content)
        root = ET.fromstring(response.content)
        locations = [e.text for e in root.iter() if e.tag.endswith('}loc') or e.tag == 'loc']
        if root.tag.endswith('sitemapindex'):
            maps.extend(locations)
        else:
            seeds.update(u for loc in locations if (u := normalize(loc)))
    except Exception as e:
        sitemap_errors.append({'url': url, 'error': str(e)})
dump(OUT / 'metadata/sitemap_urls.json', sorted(seeds))
print(f'Discovered {len(seeds)} sitemap URLs across {len(seen_maps)} sitemaps', flush=True)

def process(url):
    if not robots.can_fetch(UA, url):
        return {'url': url, 'status': 'robots_blocked'}, []
    r = fetch(url)
    record = {'url': url, 'final_url': r.url, 'http_status': r.status_code,
              'fetched_at': datetime.now(timezone.utc).isoformat(),
              'content_type': r.headers.get('Content-Type', ''),
              'last_modified': r.headers.get('Last-Modified'),
              'sha256': hashlib.sha256(r.content).hexdigest()}
    if not r.ok:
        return dict(record, status='http_error'), []
    if normalize(r.url) is None:
        return dict(record, status='external_redirect'), []
    key = hashlib.sha256(url.encode()).hexdigest()[:20]
    links = []
    if r.content.startswith(b'%PDF') or 'application/pdf' in record['content_type']:
        path = OUT / 'pdfs' / (key + '.pdf')
        path.write_bytes(r.content)
        pages = []
        try:
            reader = PdfReader(io.BytesIO(r.content))
            for number, page in enumerate(reader.pages, 1):
                pages.append({'page': number, 'text': page.extract_text() or ''})
            record.update(kind='pdf', status='ok', raw_file=path.as_posix(),
                          title=str((reader.metadata or {}).get('/Title', '')), pages=pages,
                          text='\n\n'.join(p['text'] for p in pages), page_count=len(pages))
            record['needs_ocr'] = any(len(p['text'].strip()) < 30 for p in pages)
        except Exception as e:
            record.update(kind='pdf', status='extraction_error', raw_file=path.as_posix(), error=str(e))
    elif 'html' in record['content_type']:
        path = OUT / 'raw_html' / (key + '.html')
        path.write_bytes(r.content)
        soup = BeautifulSoup(r.content, 'html.parser')
        all_links = [{'text': a.get_text(' ', strip=True), 'url': urljoin(r.url, a['href'])}
                     for a in soup.select('a[href]')]
        links = [u for a in all_links if (u := normalize(a['url']))]
        title = soup.title.get_text(' ', strip=True) if soup.title else ''
        canonical = soup.select_one('link[rel="canonical"]')
        meta = soup.select_one('meta[name="description"]')
        structured = [tag.get_text() for tag in soup.select('script[type="application/ld+json"]')]
        for tag in soup.select('script, style, noscript, nav, header, footer, form'):
            tag.decompose()
        main = soup.select_one('main') or soup.select_one('#content') or soup.body or soup
        headings = [{'level': int(h.name[1]), 'text': h.get_text(' ', strip=True)} for h in main.select('h1,h2,h3,h4,h5,h6')]
        tables = [[[cell.get_text(' ', strip=True) for cell in row.select('th,td')]
                   for row in table.select('tr')] for table in main.select('table')]
        images = [{'alt': img.get('alt', ''), 'url': urljoin(r.url, img.get('data-src') or img.get('src') or '')}
                  for img in main.select('img')]
        text = '\n'.join(line.strip() for line in main.get_text('\n').splitlines() if line.strip())
        record.update(kind='html', status='ok', title=title,
                      canonical_url=canonical.get('href') if canonical else None,
                      description=meta.get('content') if meta else None, raw_file=path.as_posix(),
                      text=text, headings=headings, tables=tables, links=all_links,
                      images=images, structured_data_raw=structured)
    else:
        record.update(status='unsupported_type')
    if 'text' in record:
        record['text_length'] = len(record['text'])
    record['document_file'] = (OUT / 'documents' / (key + '.json')).as_posix()
    dump(OUT / 'documents' / (key + '.json'), record)
    return record, links

pending = deque(sorted(seeds))
seen = set()
records = []
with cf.ThreadPoolExecutor(max_workers=3) as pool:
    while pending:
        batch = []
        while pending and len(batch) < 12:
            url = pending.popleft()
            if url not in seen:
                seen.add(url)
                batch.append(url)
        jobs = {pool.submit(process, url): url for url in batch}
        for job in cf.as_completed(jobs):
            url = jobs[job]
            try:
                record, discovered = job.result()
                pending.extend(u for u in discovered if u not in seen)
            except Exception as e:
                record = {'url': url, 'status': 'fetch_error', 'error': str(e)}
            records.append(record)
            print(f'{len(records)} {record["status"]} {url}', flush=True)
        dump(OUT / 'crawl_manifest.json', records)

records.sort(key=lambda x: x['url'])
dump(OUT / 'knowledge_base.json', {'source': BASE, 'started_at': START,
     'completed_at': datetime.now(timezone.utc).isoformat(), 'documents': records})
with (OUT / 'knowledge_base.jsonl').open('w', encoding='utf-8') as f:
    for record in records:
        f.write(json.dumps(record, ensure_ascii=False) + '\n')
issues = [r for r in records if r['status'] != 'ok' or r.get('needs_ocr') or r.get('text_length', 100) < 100]
dump(OUT / 'issues.json', {'documents': issues, 'sitemap_errors': sitemap_errors})
counts = {status: sum(r['status'] == status for r in records) for status in sorted({r['status'] for r in records})}
report = {'source': BASE, 'started_at': START, 'completed_at': datetime.now(timezone.utc).isoformat(),
          'sitemap_count': len(seen_maps), 'sitemap_seed_count': len(seeds), 'visited_count': len(records),
          'status_counts': counts, 'html_count': sum(r.get('kind') == 'html' for r in records),
          'pdf_count': sum(r.get('kind') == 'pdf' for r in records),
          'pdf_page_count': sum(r.get('page_count', 0) for r in records),
          'issue_count': len(issues), 'sitemap_errors': sitemap_errors,
          'scope': 'Public same-domain HTML and linked PDFs; no authentication, external websites, OCR, image text or JavaScript rendering.'}
dump(OUT / 'report.json', report)
print(json.dumps(report, indent=2), flush=True)
