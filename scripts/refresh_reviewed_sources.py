"""Refresh audited pages and locally OCR the linked legacy form; never mutate archive."""
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import fitz
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/source_updates'

def save(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')

def section(title, text):
    return {'heading': title, 'blocks': [{'kind': 'text', 'text': text}], 'page_start': None, 'page_end': None}

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    archive = json.loads((ROOT/'data/austra_crawl/knowledge_base.json').read_text(encoding='utf-8'))['documents']
    # Fixed audit list makes subsequent runs independent of updated preparation decisions.
    slugs = ['agent-review-form','application-leave-form','change-of-details-form',
        'complaint-grievance-or-appeal-form','course-transfer-request-form','credit-transfer-form',
        'critical-incident-report-form','deferral-suspension-or-cancellation-request-form',
        'discontinuation-deferring-of-studies-form','education-agent-information-update-form',
        'education-agent-performance-review-form','hazard-incident-report-form-2',
        'hazard-incident-report-form','policies-forms']
    targets = [d for d in archive if d['url'].rstrip('/').rsplit('/',1)[-1] in slugs or d['url'].rstrip('/') == 'https://austra.edu.au/courses']
    now = datetime.now(timezone.utc).isoformat()
    def fetch(d):
        # The site serves stale HTML at /courses/ but redirects /courses to its new URL.
        request_url = d['url'].rstrip('/') if d['url'].rstrip('/') == 'https://austra.edu.au/courses' else d['url']
        r = requests.get(request_url, timeout=45, headers={'User-Agent':'AustraKnowledgeRefresh/1.0'})
        r.raise_for_status()
        path = OUT / (hashlib.sha256(d['url'].encode()).hexdigest()[:20]+'.html')
        path.write_bytes(r.content)
        soup = BeautifulSoup(r.content,'lxml')
        canonical = soup.select_one('link[rel="canonical"]')
        return d, soup, {'url':d['url'], 'raw_file':path.relative_to(ROOT).as_posix(),
            'final_url':r.url, 'canonical_url':canonical.get('href') if canonical else r.url,
            'title':soup.title.get_text(strip=True) if soup.title else d.get('title'),
            'sha256':hashlib.sha256(r.content).hexdigest(),'fetched_at':now}
    overlays, review = [], []
    for old,soup,update in ThreadPoolExecutor(max_workers=3).map(fetch, targets):
        if old['url'].rstrip('/') == 'https://austra.edu.au/courses':
            overlays.append(update)
            continue
        links = {}
        for a in soup.select('a[href]'):
            href = urljoin(update['final_url'],a['href'])
            if '.pdf' in href.lower():
                label = a.get_text(' ',strip=True)
                if label: links[href] = label
        for tag in soup.select('script,style,noscript,nav,header,footer,form'):
            tag.decompose()
        main = soup.select_one('main') or soup.select_one('#content') or soup.body or soup
        text = ' '.join(main.stripped_strings)
        item = {'url':old['url'],'checked_at':now,'main_text':text,'pdf_links':links,
            'decision':'retain_exclusion','reason':'No distinct form fields or downloadable PDF; generic enquiry widget is not this named form.'}
        if links:
            item.update(decision='include_directory',reason='Preserve explicitly linked document names and destinations with legacy warning.')
            update['reviewed_sections'] = [section('Legacy policies and forms directory',
                'This public directory links legacy documents. Links do not establish that these are current approved policies. For current policy rules use newer Austra policy sources; confirm form versions with admissions.\n'+
                '\n'.join(f'{label}: {url}' for url,label in links.items()))]
            update['additional_review_flags'] = ['legacy_directory_links_not_current_policy_approval']
        elif old['url'].rstrip('/').endswith('/change-of-details-form'):
            assert 'every 6 months or when a change occurs' in text
            item.update(decision='include_instruction', reason='Unique student update frequency instruction is present despite short page text.')
            update['reviewed_sections'] = [section('Change of Details Form',
                'The public Change of Details Form page states: "Must be completed by each current student every 6 months or when a change occurs". The page does not expose distinct form fields or a downloadable PDF in its public HTML. Do not invent required fields or submission steps.')]
            update['additional_review_flags'] = ['short_public_instruction_form_fields_not_available']
        overlays.append(update)
        review.append(item)
    save('thin_pages_review.json',review)
    # Only these two explicitly linked forms bypass the blanket legacy exclusion.
    for old in archive:
        if not any(old['url'].endswith('/'+name) for name in ['Agent-Review-Form.pdf','Education-Agent-Performance-Review-Form.pdf']):
            continue
        update = {'url':old['url'],'audited_legacy_form':True,
            'additional_review_flags':['legacy_2023_form_confirm_current_version_with_college']}
        if old.get('needs_ocr'):
            from rapidocr_onnxruntime import RapidOCR
            engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)
            pdf = fitz.open(ROOT/old['raw_file'])
            pages, evidence = [], []
            for i,page in enumerate(pdf):
                img = OUT/f'agent-performance-page-{i+1}.png'
                page.get_pixmap(dpi=220).save(img)
                result,_ = engine(str(img))
                lines = [{'text':r[1],'confidence':float(r[2]),'box':r[0]} for r in result or []]
                text = '\n'.join(r['text'] for r in lines)
                # Spacing/case corrections checked against both rendered pages.
                corrections = {'LocationofEducation':'Location of Education',
                    'satisfactionwith agent(Refer to thesurvey results).':'satisfaction with agent (Refer to the survey results).',
                    'ResponsivenessoftheagenttocommunicationfromInstitute.':'Responsiveness of the agent to communication from Institute.',
                    'BelowAverage':'Below Average','ESOs Act':'ESOS Act',
                    'Theeducationagentisreliable andethical.':'The education agent is reliable and ethical.',
                    'Additionalcomments:':'Additional comments:', 'VersionControl':'Version Control',
                    'Initialdocument-TransferfromACTEtoAUSTRACOLLEGE':'Initial document - Transfer from ACTE to AUSTRA COLLEGE'}
                for before,after in corrections.items():
                    text = text.replace(before,after)
                text = 'Legacy blank form v1.0 (2023); confirm the current version with the college. Describes fields and rating options, not a completed agent evaluation.\n' + text
                pages.append({'page':i+1,'text':text})
                evidence.append({'page':i+1,'lines':lines,'reviewed_text':text,'corrections':corrections})
            save('agent_performance_ocr.json',{'source_url':old['url'],'source_sha256':old['sha256'],
                'engine':'rapidocr_onnxruntime','dpi':220,'created_at':now,'pages':evidence})
            update.update(pages=pages,needs_ocr=False,text='\n'.join(p['text'] for p in pages))
        else:
            update['pages'] = [{**p, 'text':'Legacy linked blank form; confirm the current version with the college. This is not a completed agent evaluation.\n'+p['text']} for p in old['pages']]
        overlays.append(update)
    save('overrides.json',overlays)
    print(json.dumps({'refreshed_html':len(targets),'reviewed_thin_pages':len(review),
        'directories_added':sum(r['decision']=='include_directory' for r in review),
        'instructions_added':sum(r['decision']=='include_instruction' for r in review),
        'legacy_forms_added':2,'ocr_pages':2},indent=2))

if __name__ == '__main__':
    main()
