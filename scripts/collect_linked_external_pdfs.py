"""Collect only externally hosted PDFs directly referenced by the Austra archive."""
import concurrent.futures as cf
import hashlib
import io
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser
import requests
from pypdf import PdfReader

root = Path('data/austra_crawl')
data = json.loads((root / 'knowledge_base.json').read_text(encoding='utf-8'))
sources = {}
for doc in data['documents']:
    for link in doc.get('links', []):
        url = link['url']
        if urlsplit(url).path.lower().endswith('.pdf') and urlsplit(url).hostname not in ('austra.edu.au', 'www.austra.edu.au'):
            sources.setdefault(url, []).append(doc['url'])
ua = 'AustraKnowledgeArchive/1.0 (public website content research)'
rp = RobotFileParser('https://educert.net/robots.txt')
try:
    r = requests.get(rp.url, timeout=30, headers={'User-Agent': ua})
    if r.status_code == 200:
        rp.parse(r.text.splitlines())
    elif r.status_code == 404:
        rp.parse([])
    else:
        rp.disallow_all = True
except requests.RequestException:
    rp.disallow_all = True

def collect(url):
    record = {'url': url, 'linked_from': sorted(set(sources[url])), 'external_linked_pdf': True,
              'fetched_at': datetime.now(timezone.utc).isoformat()}
    if urlsplit(url).hostname != 'educert.net':
        return dict(record, status='malformed_external_link')
    if not rp.can_fetch(ua, url):
        return dict(record, status='robots_blocked')
    try:
        time.sleep(0.5)
        r = requests.get(url, timeout=(15, 45), headers={'User-Agent': ua})
        record.update(http_status=r.status_code, final_url=r.url, content_type=r.headers.get('Content-Type', ''))
        if not r.ok:
            return dict(record, status='http_error')
        if not r.content.startswith(b'%PDF'):
            return dict(record, status='not_pdf')
        key = hashlib.sha256(url.encode()).hexdigest()[:20]
        raw = root / 'pdfs' / (key + '.pdf')
        raw.write_bytes(r.content)
        reader = PdfReader(io.BytesIO(r.content))
        pages = [{'page': i, 'text': p.extract_text() or ''} for i, p in enumerate(reader.pages, 1)]
        text = '\n\n'.join(p['text'] for p in pages)
        record.update(status='ok', kind='pdf', raw_file=raw.as_posix(),
                      sha256=hashlib.sha256(r.content).hexdigest(), pages=pages, text=text,
                      text_length=len(text), page_count=len(pages),
                      needs_ocr=any(len(p['text'].strip()) < 30 for p in pages),
                      document_file=(root / 'documents' / (key + '.json')).as_posix())
        Path(record['document_file']).write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
        return record
    except Exception as e:
        return dict(record, status='fetch_or_extraction_error', error=str(e))

with cf.ThreadPoolExecutor(max_workers=2) as pool:
    for record in pool.map(collect, sorted(sources)):
        data['documents'].append(record)
        print(record['status'], record['url'], flush=True)
data['documents'].sort(key=lambda d: d['url'])
(root / 'knowledge_base.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
report = json.loads((root / 'report.json').read_text(encoding='utf-8'))
docs = data['documents']
report.update(visited_count=len(docs), external_linked_pdf_urls=len(sources),
              html_count=sum(d.get('kind') == 'html' for d in docs),
              pdf_count=sum(d.get('kind') == 'pdf' for d in docs),
              pdf_page_count=sum(d.get('page_count', 0) for d in docs),
              status_counts={s: sum(d['status'] == s for d in docs) for s in sorted({d['status'] for d in docs})},
              scope='Public Austra HTML and linked PDFs, including directly linked legacy educert.net PDFs; no external website crawl, authentication, OCR, image text or JavaScript rendering.')
issues = [d for d in docs if d['status'] != 'ok' or d.get('needs_ocr') or d.get('text_length', 100) < 100]
report['issue_count'] = len(issues)
(root / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
(root / 'issues.json').write_text(json.dumps({'documents': issues, 'sitemap_errors': report['sitemap_errors']}, ensure_ascii=False, indent=2), encoding='utf-8')
