"""Finalize the live audit with human-readable findings and structured-data checks."""
import json
import re
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit,unquote,urlunsplit
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/coverage_audit'
def norm(url):
    p=urlsplit(url);return urlunsplit(('https',(p.hostname or '').removeprefix('www.'),unquote(p.path).rstrip('/') or '/','',''))
def run():
    report=json.loads((OUT/'report.json').read_text(encoding='utf-8'))
    raw=json.loads((ROOT/'data/austra_crawl/knowledge_base.json').read_text(encoding='utf-8'))['documents']
    old={norm(d['url']):d for d in raw}
    page_urls=set();image_urls=set()
    for path in OUT.glob('*.xml'):
        root=ET.parse(path).getroot()
        if root.tag.endswith('sitemapindex'):continue
        for entry in list(root):
            for child in list(entry):
                if child.tag.rsplit('}',1)[-1]=='loc' and child.text:page_urls.add(norm(child.text))
                elif child.tag.rsplit('}',1)[-1]=='image':
                    image_urls.update(norm(x.text) for x in child if x.tag.rsplit('}',1)[-1]=='loc' and x.text)
    report['discovery']['sitemap_urls']=len(page_urls)
    report['discovery']['sitemap_image_urls']=len(image_urls)
    report['sitemap_missing_from_archive']=sorted(u for u in page_urls if u not in old)
    report['sitemap_successfully_archived']=sum(u in old and old[u]['status']=='ok' for u in page_urls)
    report['sitemap_failed_in_archive']=[u for u in page_urls if u in old and old[u]['status']!='ok']
    live_pages=json.loads((OUT/'live_pages.json').read_text(encoding='utf-8'))
    redirects={norm(p['final_url']):p['url'] for p in live_pages if p.get('archived') and p.get('final_url') and norm(p['final_url'])!=norm(p['url'])}
    report['new_redirect_aliases']=[dict(p,existing_archived_entry=redirects[norm(p['final_url'])]) for p in report['new_successful_pages'] if norm(p.get('final_url',p['url'])) in redirects]
    report['new_distinct_pages']=[p for p in report['new_successful_pages'] if norm(p.get('final_url',p['url'])) not in redirects]
    changes_path=OUT/'content_changes.json'
    if changes_path.exists():report['content_change_details']=json.loads(changes_path.read_text(encoding='utf-8'))
    external=json.loads((OUT/'external_links.json').read_text(encoding='utf-8'))
    report['malformed_document_links']=[x for x in external if x['url'].lower().endswith('.pdf') and (urlsplit(x['url']).hostname or '').startswith('https')]
    report['unarchived_redirect_targets']=[{'archived_url':p['url'],'current_target':p['final_url']} for p in live_pages if p.get('archived') and p.get('final_url') and norm(p['final_url']) not in old]
    report['potential_information_images']=[x for x in report['potential_information_images'] if not x['url'].startswith('data:')]
    documents=[json.loads(s) for s in (ROOT/'data/processed/documents.jsonl').read_text(encoding='utf-8').splitlines()]
    chunks=[json.loads(s) for s in (ROOT/'data/processed/chunks.jsonl').read_text(encoding='utf-8').splitlines()]
    decisions=json.loads((ROOT/'data/processed/source_decisions.json').read_text(encoding='utf-8'))
    report['chatbot']={'documents':len(documents),'chunks':len(chunks),'categories':dict(Counter(d['category'] for d in documents)),
        'html_documents':sum(d['source_type']=='html' for d in documents),'pdf_documents':sum(d['source_type']=='pdf' for d in documents),
        'unique_course_codes':len({d['course_code'] for d in documents if d['category']=='course'}),
        'intake_state_records':dict(Counter(c['metadata']['state'] for c in chunks if c['category']=='intake')),
        'excluded_reasons':dict(Counter(d['reason'] for d in decisions if d['decision']=='excluded')),
        'review_status_counts':dict(Counter(d['review_status'] for d in documents))}
    embedded={}
    for doc in raw:
        if doc.get('kind')!='html':continue
        text=(ROOT/doc['raw_file']).read_text(encoding='utf-8',errors='replace').replace('\\/','/')
        for url in re.findall(r'https?://[^\s\"\x27<>]+?\.(?:pdf|docx?|xlsx?|pptx?|zip)(?:\?[^\s\"\x27<>]*)?',text,re.I):
            if urlsplit(url).hostname in ('austra.edu.au','www.austra.edu.au','educert.net'):
                embedded.setdefault(norm(url),[]).append(doc['url'])
    report['embedded_documents_not_in_archive']=[{'url':u,'linked_from':sorted(set(p))} for u,p in embedded.items() if u not in old]
    report['manual_pdf_review']=[
        {'url':'https://austra.edu.au/wp-content/uploads/2026/08/RTO-CRICOS-Student-Handbook-V1.5-1.pdf','page':1,'finding':'Cover image; body text is extracted on later pages.'},
        {'url':'https://educert.net/austracollegeweb/wp-content/uploads/2023/12/Education-Agent-Performance-Review-Form.pdf','pages':[1,2],'finding':'Both pages are scanned form images with substantive labels; text extraction contains only 2 characters. OCR is required. This legacy document is not in the chatbot corpus.'}]
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# Austra public-content coverage audit','',f"Checked: {report['audited_at']}",'',
        '## Conclusion','',
        'The archived sitemap pages are covered, but this is not proof of complete public-content extraction. The chatbot uses a curated subset. Scanned/image text, failed links, excluded form pages and unlinked/JS-loaded resources remain separate concerns.','',
        '| Measure | Result |','|---|---|',
        f"| Current sitemap pages | {len(page_urls)} |",f"| Sitemap pages successfully in archive | {report['sitemap_successfully_archived']} |",
        f"| Current live page URLs checked | {report['live_pages_checked']} |",f"| Newly discovered successful URLs | {len(report['new_successful_pages'])} |",f"| New redirect aliases / distinct new pages | {len(report['new_redirect_aliases'])} / {len(report['new_distinct_pages'])} |",
        f"| Archived successful HTML / PDF | {report['archive']['successful_html']} / {report['archive']['successful_pdf']} |",
        f"| Archived PDF pages | {report['archive']['pdf_pages']} |",f"| Raw integrity checks | {'PASS' if report['archive']['raw_integrity_ok'] else 'FAIL'} |",
        f"| Chatbot documents / chunks | {len(documents)} / {len(chunks)} |",f"| Changed main-text pages | {len(report['changed_main_text'])} |",
        f"| Live linked documents checked | {report['linked_documents_checked']} |",f"| Successful linked documents missing from archive | {len(report['missing_successful_documents'])} |",'',
        '## Current chatbot coverage','','```json',json.dumps(report['chatbot'],indent=2),'```','',
        '## Live broken pages / documents','']
    for item in report['live_failed_pages']+report['failed_linked_documents']:
        lines.append(f"- {item['url']} — {item['status']}")
    for item in report['malformed_document_links']:
        lines.append(f"- Malformed PDF link: {item['label']} on {item['linked_from']}. The encoded hostname is invalid; no request was made to that hostname.")
    lines+=['','## Snapshot changes','']
    for item in report['changed_main_text']:
        lines.append(f"- {item['url']} now resolves to {item['final_url']}. Main text changed; see content_changes.json for exact differences.")
    lines+=['','## Extraction and inclusion gaps','',
        '- Fourteen low-content form/index HTML pages were excluded. Their raw pages were archived; some form labels are present only in archived form metadata, and many fields are a repeated general enquiry widget.',
        '- The legacy two-page Education Agent Performance Review Form is image-only and needs OCR. Handbook cover low-text flags do not mean the whole handbook is missing.',
        f"- {len(image_urls)} image URLs occur in the sitemap. Images were referenced, not comprehensively downloaded/OCRed; this includes ordinary photos, logos and banners, not necessarily missing facts.",
        '- The public WordPress REST listing was checked but requires authentication. No authentication bypass was attempted.',
        '- Archived HTML and linked PDFs are a snapshot; login portals, submitted forms, unlinked files, image/video text and JavaScript-only responses are not established as covered.',
        '- All selected source documents remain pending staff review. Version selection by filename/upload path is not authoritative approval.','',
        '## Items to review before asserting complete coverage','',
        '1. OCR the scanned form and verify whether a current Austra replacement exists.',
        '2. Review the excluded low-content form pages and retain any unique instructions, form names and download links in chatbot data.',
        '3. Have the college repair broken/malformed links or provide the intended documents.',
        '4. Review informational images and any JS-only content separately.',
        '5. Compare the school-approved public document/course inventory against the crawl; a link crawl cannot prove that unlinked public files do not exist.','',
        'Machine-readable evidence and URL lists are in report.json, live_pages.json, linked_documents.json and integrity.json. The audit does not modify embeddings, Supabase or the curated corpus.']
    (OUT/'SUMMARY.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ('sitemap_successfully_archived','live_pages_checked','chatbot')},indent=2))
if __name__=='__main__':run()
