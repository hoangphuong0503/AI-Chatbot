import difflib
import json
import re
from pathlib import Path
import requests
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/coverage_audit'
def text(raw):
    soup=BeautifulSoup(raw,'html.parser')
    for t in soup.select('script,style,noscript,nav,header,footer,form'):t.decompose()
    main=soup.select_one('main') or soup.select_one('#content') or soup.body or soup
    return re.sub(r'\s+',' ',main.get_text(' ',strip=True)).strip()
pages=json.loads((OUT/'live_pages.json').read_text(encoding='utf-8'))
archive=json.loads((ROOT/'data/austra_crawl/knowledge_base.json').read_text(encoding='utf-8'))['documents']
findings=[]
for page in pages:
    if not page.get('main_text_changed'):continue
    old=next(d for d in archive if d['url'].rstrip('/')==page['url'].rstrip('/'))
    r=requests.get(page['final_url'],headers={'User-Agent':'AustraCoverageAudit/1.0'},timeout=30);r.raise_for_status()
    before=text((ROOT/old['raw_file']).read_bytes()).split();after=text(r.content).split()
    changes=[]
    for kind,i,j,a,b in difflib.SequenceMatcher(None,before,after,autojunk=False).get_opcodes():
        if kind!='equal':changes.append({'type':kind,'before':' '.join(before[i:j]),'after':' '.join(after[a:b])})
    findings.append({'url':page['url'],'final_url':r.url,'changes':changes})
(OUT/'content_changes.json').write_text(json.dumps(findings,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(findings,ensure_ascii=True,indent=2))
