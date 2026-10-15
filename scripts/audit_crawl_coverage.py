"""Read-only live coverage audit. Writes evidence separately; never changes the corpus."""
import concurrent.futures as cf
import hashlib
import json
import re
import time
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit, unquote
from urllib.robotparser import RobotFileParser
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
ARCHIVE=ROOT/'data/austra_crawl'
OUT=ROOT/'data/coverage_audit'
OUT.mkdir(parents=True,exist_ok=True)
UA='AustraCoverageAudit/1.0 (public source verification)'
BASE='https://austra.edu.au/'
docs=json.loads((ARCHIVE/'knowledge_base.json').read_text(encoding='utf-8'))['documents']
def norm(url):
    p=urlsplit(url)
    if p.scheme not in ('http','https'):return None
    host=(p.hostname or '').lower().removeprefix('www.')
    return urlunsplit(('https',host,unquote(p.path).rstrip('/') or '/','',''))
old={norm(d['url']):d for d in docs}
for d in docs:
    for key in ('final_url','canonical_url'):
        if d.get(key):old.setdefault(norm(d[key]),d)
def save(name,value):
    (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
def get(url):
    last=None
    for attempt in range(2):
        try:
            time.sleep(.25)
            r=requests.get(url,headers={'User-Agent':UA},timeout=(10,35))
            if r.status_code in (429,500,502,503,504) and not attempt:
                time.sleep(2);continue
            return r
        except requests.RequestException as e:last=e
    raise last
robots=get(BASE+'robots.txt');robots.raise_for_status()
(OUT/'robots.txt').write_text(robots.text,encoding='utf-8')
rp=RobotFileParser();rp.parse(robots.text.splitlines())
maps=list(rp.site_maps() or [BASE+'sitemap_index.xml']);seen_maps=set();sitemap_urls=set();errors=[]
while maps:
    url=maps.pop(0)
    if url in seen_maps:continue
    seen_maps.add(url)
    try:
        r=get(url);r.raise_for_status();root=ET.fromstring(r.content)
        (OUT/(hashlib.sha256(url.encode()).hexdigest()[:16]+'.xml')).write_bytes(r.content)
        # Only the URL/sitemap entry's direct loc; image:loc is an asset, not a page.
        locs=[x.text for parent in list(root) for x in list(parent) if x.tag.rsplit('}',1)[-1]=='loc' and x.text]
        if root.tag.endswith('sitemapindex'):maps.extend(locs)
        else:sitemap_urls.update(norm(u) for u in locs if norm(u))
    except Exception as e:errors.append({'url':url,'error':str(e)})
api_urls=set();api_checks=[]
for kind in ('pages','posts'):
    page=1
    while page<=10:
        url=BASE+f'wp-json/wp/v2/{kind}?per_page=100&page={page}&_fields=id,link,slug,status,modified_gmt'
        try:
            r=get(url)
            api_checks.append({'kind':kind,'page':page,'status':r.status_code,'total':r.headers.get('X-WP-Total')})
            if r.status_code!=200:break
            rows=r.json()
            if not isinstance(rows,list):break
            api_urls.update(norm(row['link']) for row in rows if row.get('link'))
            if page>=int(r.headers.get('X-WP-TotalPages','1')):break
            page+=1
        except Exception as e:api_checks.append({'kind':kind,'error':str(e)});break
assets={};external={};queries={};forms=[];image_candidates=[];integrity=[]
for d in docs:
    if d.get('raw_file'):
        p=ROOT/d['raw_file']
        integrity.append({'url':d['url'],'exists':p.exists(),'hash_ok':p.exists() and hashlib.sha256(p.read_bytes()).hexdigest()==d['sha256']})

def is_page(url):
    p=urlsplit(url)
    return p.hostname=='austra.edu.au' and not p.path.startswith(('/wp-admin','/wp-json','/wp-login','/feed','/xmlrpc')) and not re.search(r'\.[a-z0-9]{1,5}$',p.path,re.I)
def main_text(raw):
    soup=BeautifulSoup(raw,'html.parser')
    for t in soup.select('script,style,noscript,nav,header,footer,form'):t.decompose()
    main=soup.select_one('main') or soup.select_one('#content') or soup.body or soup
    return re.sub(r'\s+',' ',main.get_text(' ',strip=True)).strip()
def fetch_page(url):
    if not rp.can_fetch(UA,url):return {'url':url,'status':'robots_blocked'},[]
    try:
        r=get(url)
        record={'url':url,'status':r.status_code,'final_url':r.url,'archived':url in old,'content_type':r.headers.get('Content-Type','')}
        if r.status_code!=200 or 'html' not in record['content_type']:return record,[]
        soup=BeautifulSoup(r.content,'html.parser');record['title']=soup.title.get_text(' ',strip=True) if soup.title else ''
        record['canonical']=soup.select_one('link[rel="canonical"]').get('href') if soup.select_one('link[rel="canonical"]') else None
        text=main_text(r.content);record['main_text_length']=len(text)
        prior=old.get(url)
        if prior and prior.get('kind')=='html':
            record['main_text_changed']=text!=main_text((ROOT/prior['raw_file']).read_bytes())
        else:
            path=OUT/('new-'+hashlib.sha256(url.encode()).hexdigest()[:16]+'.html');path.write_bytes(r.content);record['audit_raw_file']=str(path.relative_to(ROOT))
        links=[]
        for node in soup.select('a[href],iframe[src],embed[src],object[data],video[src],audio[src]'):
            link=urljoin(r.url,node.get('href') or node.get('src') or node.get('data') or '')
            normalized=norm(link)
            if not normalized:continue
            item={'url':link,'label':node.get_text(' ',strip=True)[:120],'linked_from':url}
            p=urlsplit(link)
            if p.query and p.hostname in ('austra.edu.au','www.austra.edu.au'):queries.setdefault(link,item)
            if re.search(r'\.(pdf|docx?|xlsx?|pptx?|csv|zip)(?:$)',p.path,re.I):assets.setdefault(normalized,item)
            if p.hostname not in ('austra.edu.au','www.austra.edu.au'):external.setdefault(link,item)
            if is_page(normalized):links.append(normalized)
        for form in soup.select('form'):
            labels=[x.get('aria-label') or x.get('placeholder') or x.get('name') for x in form.select('input,select,textarea') if x.get('type') not in ('hidden','submit')]
            if labels:forms.append({'url':url,'fields':labels,'archived':url in old})
        for img in soup.select('main img,article img'):
            src=urljoin(r.url,img.get('data-src') or img.get('src') or '')
            alt=img.get('alt','')
            if re.search(r'brochure|flyer|poster|intake|timetable|fee|prospectus',src+' '+alt,re.I):image_candidates.append({'url':src,'alt':alt,'linked_from':url})
        return record,links
    except Exception as e:return {'url':url,'status':'fetch_error','error':str(e),'archived':url in old},[]
pending={BASE}|{u for u in sitemap_urls|api_urls if is_page(u)}|{norm(d['url']) for d in docs if d.get('kind')=='html'}|{norm(d['url']) for d in docs if d['status']!='ok' and is_page(norm(d['url']))}
seen=set();pages=[]
with cf.ThreadPoolExecutor(max_workers=3) as pool:
    while pending and len(seen)<600:
        batch=sorted(pending-seen)[:15]
        if not batch:break
        pending.difference_update(batch);seen.update(batch)
        for record,links in pool.map(fetch_page,batch):
            pages.append(record);pending.update(u for u in links if u not in seen)
        print(f'Audited {len(pages)} pages; {len(pending-seen)} pending',flush=True)
        save('live_pages.json',pages)
asset_results=[]
def inspect_asset(item):
    url,item=item
    if not urlsplit(url).hostname in ('austra.edu.au','educert.net'):
        return dict(item,normalized=url,archived=url in old,status='external_not_fetched')
    try:
        r=get(item['url']);prior=old.get(url)
        return dict(item,normalized=url,archived=bool(prior and prior['status']=='ok'),status=r.status_code,
            content_type=r.headers.get('Content-Type'),bytes=len(r.content),hash_changed=bool(prior and prior.get('sha256')!=hashlib.sha256(r.content).hexdigest()))
    except Exception as e:return dict(item,normalized=url,status='fetch_error',error=str(e),archived=url in old)
with cf.ThreadPoolExecutor(max_workers=2) as pool:
    for record in pool.map(inspect_asset,sorted(assets.items())):asset_results.append(record)
decisions=json.loads((ROOT/'data/processed/source_decisions.json').read_text(encoding='utf-8'))
excluded=[d for d in decisions if d['decision']=='excluded']
report={'audited_at':datetime.now(timezone.utc).isoformat(),'archive_started_at':json.loads((ARCHIVE/'report.json').read_text())['started_at'],
 'archive':{'url_records':len(docs),'successful_html':sum(d.get('kind')=='html' and d['status']=='ok' for d in docs),'successful_pdf':sum(d.get('kind')=='pdf' and d['status']=='ok' for d in docs),'pdf_pages':sum(d.get('page_count',0) for d in docs),'raw_integrity_ok':all(i['exists'] and i['hash_ok'] for i in integrity)},
 'discovery':{'sitemaps':len(seen_maps),'sitemap_urls':len(sitemap_urls),'api_urls':len(api_urls),'api_checks':api_checks,'errors':errors,'crawl_capped':bool(pending-seen)},
 'live_pages_checked':len(pages),'live_status_counts':dict(Counter(str(p['status']) for p in pages)),
 'sitemap_missing_from_archive':sorted(u for u in sitemap_urls if u not in old),
 'api_missing_from_archive':sorted(u for u in api_urls if u not in old),
 'new_successful_pages':[p for p in pages if p['status']==200 and not p['archived']],
 'changed_main_text':[p for p in pages if p.get('main_text_changed')],
 'live_failed_pages':[p for p in pages if p['status']!=200],
 'linked_documents_checked':len(asset_results),'missing_successful_documents':[a for a in asset_results if not a['archived'] and a['status']==200],
 'failed_linked_documents':[a for a in asset_results if a['status']!=200],
 'changed_document_hashes':[a for a in asset_results if a.get('hash_changed') and a['status']==200],
 'pdf_low_text_pages':[{'url':d['url'],'pages':[p['page'] for p in d.get('pages',[]) if len(p['text'].strip())<30]} for d in docs if d.get('needs_ocr')],
 'excluded_from_chatbot':excluded,'forms_with_fields':forms,'potential_information_images':image_candidates,
 'unresolved_query_links':list(queries.values()),'external_links_count':len(external),
 'limitations':['Discovery cannot prove absence of unlinked public files.','Image text, scanned PDFs, videos and JS-only/network-loaded content require separate verification.','No login, form submission, private portals or external-site crawl performed.','Changed main text is a comparison signal, not an automatic replacement of the curated snapshot.']}
save('report.json',report);save('linked_documents.json',asset_results);save('external_links.json',list(external.values()));save('integrity.json',integrity)
print(json.dumps({k:v for k,v in report.items() if k in ('archive','discovery','live_pages_checked','live_status_counts','linked_documents_checked')},indent=2),flush=True)
print('Missing sitemap:',len(report['sitemap_missing_from_archive']),'New pages:',len(report['new_successful_pages']),'Missing documents:',len(report['missing_successful_documents']),'Changed pages:',len(report['changed_main_text']),flush=True)
