"""Write final coverage and duplicate diagnostics without changing source statements."""
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

root = Path('data/austra_crawl')
docs = json.loads((root / 'knowledge_base.json').read_text(encoding='utf-8'))['documents']
report = json.loads((root / 'report.json').read_text(encoding='utf-8'))
hashes = defaultdict(list)
for d in docs:
    if d.get('sha256'):
        hashes[d['sha256']].append(d['url'])
malformed = sorted(set(link['url'] for d in docs for link in d.get('links', [])
                       if link['url'].lower().endswith('.pdf') and
                       urlsplit(link['url']).hostname not in ('austra.edu.au', 'www.austra.edu.au', 'educert.net')))
issues = [d for d in docs if d['status'] != 'ok' or d.get('needs_ocr') or d.get('text_length', 100) < 100]
report.update(verified_at=datetime.now(timezone.utc).isoformat(),
              unique_raw_content_count=len(hashes),
              identical_raw_content_groups=[urls for urls in hashes.values() if len(urls) > 1],
              malformed_pdf_links=malformed,
              short_html_count=sum(d.get('kind')=='html' and d.get('text_length', 0)<100 for d in docs),
              pdfs_with_low_text_pages=sum(bool(d.get('needs_ocr')) for d in docs))
(root / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
(root / 'issues.json').write_text(json.dumps({'documents': issues, 'sitemap_errors': report['sitemap_errors'],
    'malformed_pdf_links': malformed}, ensure_ascii=False, indent=2), encoding='utf-8')
(root / 'pdf_index.json').write_text(json.dumps([
    {k: d.get(k) for k in ('url','raw_file','document_file','page_count','text_length','needs_ocr','linked_from')}
    for d in docs if d.get('kind') == 'pdf'], ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: report[k] for k in ('html_count','pdf_count','pdf_page_count','status_counts','short_html_count','pdfs_with_low_text_pages','unique_raw_content_count')}, indent=2))
