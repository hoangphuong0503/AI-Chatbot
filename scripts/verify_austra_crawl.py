"""Validate archive integrity; retain full page and form text alongside cleaned text."""
import hashlib
import json
from pathlib import Path
from bs4 import BeautifulSoup

root = Path('data/austra_crawl')
data = json.loads((root / 'knowledge_base.json').read_text(encoding='utf-8'))
checks = []
for doc in data['documents']:
    if doc.get('raw_file'):
        raw = Path(doc['raw_file'])
        assert raw.exists(), str(raw)
        assert hashlib.sha256(raw.read_bytes()).hexdigest() == doc['sha256'], str(raw)
        if doc.get('kind') == 'html':
            soup = BeautifulSoup(raw.read_bytes(), 'html.parser')
            doc['forms'] = []
            for form in soup.select('form'):
                doc['forms'].append({'text': form.get_text(' ', strip=True),
                    'fields': [{'tag': el.name, 'type': el.get('type'), 'name': el.get('name'),
                                'placeholder': el.get('placeholder'),
                                'label': el.get('aria-label'),
                                'options': [o.get_text(' ', strip=True) for o in el.select('option')]}
                               for el in form.select('input,select,textarea')]})
            for tag in soup.select('script,style,noscript'):
                tag.decompose()
            doc['full_page_text'] = '\n'.join(s.strip() for s in soup.get_text('\n').splitlines() if s.strip())
        if doc.get('document_file'):
            Path(doc['document_file']).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding='utf-8')
    checks.append({'url': doc['url'], 'status': doc['status'],
                   'raw_hash_verified': bool(doc.get('raw_file'))})
assert len({d['url'] for d in data['documents']}) == len(data['documents'])
(root / 'knowledge_base.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
with (root / 'knowledge_base.jsonl').open('w', encoding='utf-8') as f:
    for doc in data['documents']:
        f.write(json.dumps(doc, ensure_ascii=False) + '\n')
(root / 'crawl_manifest.json').write_text(json.dumps(data['documents'], ensure_ascii=False, indent=2), encoding='utf-8')
result = {'document_count': len(checks), 'unique_urls': True,
          'raw_files_verified': sum(c['raw_hash_verified'] for c in checks),
          'html_full_page_text_and_form_metadata_added': True}
(root / 'verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))
