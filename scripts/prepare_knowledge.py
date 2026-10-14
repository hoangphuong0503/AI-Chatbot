"""Curate the immutable crawl and create section-aware, provenance-preserving chunks."""
import hashlib
import json
import re
import statistics
import unicodedata
import uuid
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

import tiktoken
from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/processed'
ENC = tiktoken.get_encoding('cl100k_base')
MAX_TOKENS = 650
OVERLAP = 60
NS = uuid.UUID('8bb43069-76e8-413d-bb60-12b0ca5e2e94')
COURSE_RE = re.compile(r'\b(?:SIT|CPC|AUR|ICT|BSB|MSF|MEM)\d{5}\b', re.I)
EXCLUDED_SLUGS = {'account', 'my-account', 'user-account', 'user-login', 'user-register',
    'forgot-password', 'reset-password', 'cart', 'checkout', 'shop', 'maintenance',
    'sample-page', 'instructor', 'instructors', 'become-a-teacher', 'landing-page-thank-you',
    'home2', 'about-us2', 'contact2', 'courses-old', 'portfolio-masonry', 'portfolio-masonry-2',
    'map', 'gallery', 'newsletter', 'blogs'}
CORE_SLUGS = {'', 'about-us', 'contact', 'courses', 'all-courses', 'apply-now', 'agents',
    'faqs', 'fees-and-charges', 'forms', 'policies', 'policies-forms', 'privacy-policy',
    'intake-schedule', 'elicos', 'scholarship'}

def clean(text):
    text = unicodedata.normalize('NFKC', text).replace('\u00ad', '')
    return re.sub(r'\s+', ' ', text).strip()

def canonical(url):
    p = urlsplit(url)
    path = unquote(p.path).rstrip('/').rstrip(')')
    return urlunsplit((p.scheme, p.netloc, path or '/', '', ''))

def uid(text):
    return str(uuid.uuid5(NS, text))

def write_json(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def write_jsonl(name, records):
    with (OUT / name).open('w', encoding='utf-8') as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')

def classify(doc):
    slug = urlsplit(doc['url']).path.strip('/')
    if doc['status'] != 'ok':
        return 'excluded', 'failed_fetch', 'unknown'
    if doc.get('kind') == 'pdf':
        return 'candidate', None, 'policy' if any(x in slug.lower() for x in ('policy', 'handbook', 'conduct')) else 'form'
    if slug in EXCLUDED_SLUGS or slug.startswith(('tag/', 'category/', 'author/', 'portfolio', 'lp-')):
        return 'excluded', 'navigation_template_or_utility', 'utility'
    if any(term in slug for term in ('complete-guide', 'career-outcomes', 'salary-entry-requirements')):
        return 'candidate', None, 'blog'
    if re.match(r'^(sit|cpc|aur|ict|bsb|msf|mem)\d{5}-', slug) or slug in {
        'advanced-diploma-of-information-technology', 'certificate-iv-in-automotive-mechanical-diagnosis',
        'diploma-of-leadership-and-management', 'graduate-diploma-of-management-learning'}:
        return 'candidate', None, 'course'
    if slug in CORE_SLUGS or slug.endswith('-courses') or slug.endswith('-course') and slug.startswith(('ict-',)):
        return 'candidate', None, 'intake' if slug == 'intake-schedule' else 'college'
    if 'form' in slug or 'application' in slug or 'refund' in slug or 'request' in slug:
        return 'candidate', None, 'form'
    return 'candidate', None, 'blog'

def pdf_family(url):
    name = unquote(urlsplit(url).path.rsplit('/', 1)[-1]).lower()
    name = re.sub(r'\.pdf$', '', name)
    while True:
        trimmed = re.sub(r'(?:-v\d+(?:\.\d+)*|-[0-9]+)$', '', name)
        if trimmed == name:
            return name
        name = trimmed

def html_sections(doc):
    soup = BeautifulSoup((ROOT / doc['raw_file']).read_bytes(), 'lxml')
    if urlsplit(doc['url']).path.strip('/') == 'intake-schedule':
        labels = {a.get('href', '').lstrip('#'): clean(a.get_text(' ', strip=True))
                  for a in soup.select('[role="tab"]')}
        sections = []
        for panel in soup.select('.vc_tta-panel'):
            state = labels.get(panel.get('id'))
            if state not in ('VIC', 'NSW', 'SA', 'WA'):
                raise ValueError('Intake panel has no recognized state label')
            for timeline in panel.select('.course-timeline-wrapper'):
                heading = clean(timeline.find_previous('h2').get_text(' ', strip=True))
                code = COURSE_RE.search(heading)
                if not code:
                    raise ValueError('Intake timeline has no course code')
                dates = [{'day': int(b.select_one('.highlight-date').get_text(strip=True)),
                          'month_label': clean(b.select_one('.highlight-month').get_text())}
                         for b in timeline.select('.timeline-block')]
                text = 'State: ' + state + '\n' + '\n'.join(str(d['day']) + ' ' + d['month_label'] for d in dates)
                sections.append({'heading': state + ' > ' + heading,
                    'blocks': [{'kind': 'text', 'text': text}], 'page_start': None, 'page_end': None,
                    'course_code': code.group().upper(), 'state': state, 'intake_dates': dates})
        return sections
    # Elementor's wp-page is the content, whereas wp-post containers are global header/footer.
    main = soup.select_one('[data-elementor-type="wp-page"]')
    if main is None:
        main = soup.select_one('article') or soup.select_one('main') or soup.body or soup
    for tag in main.select('script,style,noscript,nav,header,footer,form,[data-elementor-type="header"],[data-elementor-type="footer"]'):
        tag.decompose()
    current = {'heading': 'Overview', 'blocks': [], 'page_start': None, 'page_end': None}
    sections = []
    hierarchy = {}

    def flush():
        if current['blocks']:
            sections.append(dict(current, blocks=list(current['blocks'])))
        current['blocks'].clear()

    def walk(node):
        if isinstance(node, NavigableString):
            value = clean(str(node))
            if value:
                current['blocks'].append({'kind': 'text', 'text': value})
            return
        if not isinstance(node, Tag):
            return
        if re.fullmatch('h[1-6]', node.name):
            flush()
            level = int(node.name[1])
            for k in list(hierarchy):
                if k >= level:
                    del hierarchy[k]
            heading = clean(node.get_text(' ', strip=True))
            hierarchy[level] = heading
            current['heading'] = ' > '.join(hierarchy.values())
            return
        if node.name == 'table':
            rows = [[clean(c.get_text(' ', strip=True)) for c in row.select('th,td')]
                    for row in node.select('tr')]
            rows = [r for r in rows if any(r)]
            if rows:
                current['blocks'].append({'kind': 'table', 'rows': rows,
                    'has_header': bool(node.select_one('tr th')), 'text': '\n'.join(' | '.join(r) for r in rows)})
            return
        if node.name in ('p', 'li', 'blockquote') and not node.select_one('h1,h2,h3,h4,h5,h6,table'):
            text = clean(node.get_text(' ', strip=True))
            if text:
                current['blocks'].append({'kind': 'text', 'text': text})
            return
        for child in node.children:
            walk(child)
    walk(main)
    flush()
    return sections

def pdf_sections(doc):
    pages = doc.get('pages', [])
    counts = Counter(clean(line) for page in pages for line in set(page['text'].splitlines()) if clean(line))
    sections = []
    heading = 'Document text'
    for page in pages:
        blocks = []
        for line in page['text'].splitlines():
            line = clean(line)
            if not line or re.match(r'^Page \d+ of \d+', line, re.I):
                continue
            if len(pages) >= 3 and counts[line] >= max(3, len(pages) * 0.6) and len(line) < 160:
                continue
            if (re.match(r'^\d+(?:\.\d+)*\.?\s+[A-Z]', line) and len(line) < 80
                    and len(line.split()) < 12 and not re.search(r'[;:]|[a-z]\.\s|[a-z]\.$', line)):
                if blocks:
                    sections.append({'heading': heading, 'blocks': blocks, 'page_start': page['page'], 'page_end': page['page']})
                    blocks = []
                heading = line
            else:
                blocks.append({'kind': 'text', 'text': line})
        if blocks:
            sections.append({'heading': heading, 'blocks': blocks, 'page_start': page['page'], 'page_end': page['page']})
    return sections

def split_text(text, limit):
    """Split on Unicode characters at whitespace, using actual tokenizer counts."""
    words = text.split()
    result, current = [], []
    for word in words:
        trial = ' '.join(current + [word])
        if len(ENC.encode(trial)) > limit and current:
            result.append(' '.join(current))
            tail = []
            for w in reversed(current):
                if len(ENC.encode(' '.join([w] + tail))) > OVERLAP:
                    break
                tail.insert(0, w)
            current = tail
        # Handle unusually long tokens (e.g. corrupt links) without exceeding the cap.
        if len(ENC.encode(word)) > limit - OVERLAP:
            if current:
                result.append(' '.join(current)); current = []
            while word:
                n = min(len(word), limit)
                while len(ENC.encode(word[:n])) > limit:
                    n = max(1, n // 2)
                result.append(word[:n]); word = word[n:]
        else:
            current.append(word)
    if current:
        result.append(' '.join(current))
    return result

def chunk_section(doc, section):
    course_context = f"Course code: {doc['course_code']}\n" if doc['course_code'] else ''
    context = f"{doc['title']}\n{course_context}Section: {section['heading']}\n"
    limit = MAX_TOKENS - len(ENC.encode(context))
    assert limit > 100, 'Context is unexpectedly long'
    result, buffer = [], []

    def flush():
        if buffer:
            result.extend(('text', t) for t in split_text('\n'.join(buffer), limit))
            buffer.clear()

    for block in section['blocks']:
        if block['kind'] != 'table':
            buffer.append(block['text'])
            continue
        flush()
        rows = block['rows']
        header = ' | '.join(rows[0]) if block['has_header'] else ''
        table = header
        for row in rows[1:] if header else rows:
            line = ' | '.join(row)
            trial = (table + '\n' + line).strip()
            if len(ENC.encode(trial)) > limit and table and table != header:
                result.append(('table', table))
                table = header
            if len(ENC.encode((table + '\n' + line).strip())) > limit:
                result.extend(('table', part) for part in split_text(line, limit - len(ENC.encode(header)) - 5))
            else:
                table = (table + '\n' + line).strip()
        if table and table != header:
            result.append(('table', table))
    flush()
    return [(kind, context + body) for kind, body in result]

def pdf_chunk_sections(sections):
    """Keep all clause headings in body text; consolidate fragmented sections per page."""
    by_page = {}
    for section in sections:
        key = section['page_start']
        if key not in by_page:
            by_page[key] = {'heading': f'Policy/document sections on page {key}',
                            'blocks': [], 'page_start': key, 'page_end': key}
        by_page[key]['blocks'].append({'kind': 'text', 'text': section['heading']})
        by_page[key]['blocks'].extend(section['blocks'])
    return list(by_page.values())

def article_chunk_sections(sections):
    """Pack short informational sections; keep FAQ answers and tables as separate units."""
    result, current = [], None
    for section in sections:
        protected = '?' in section['heading'] or 'frequently asked questions' in section['heading'].lower() or any(b['kind']=='table' for b in section['blocks'])
        if protected:
            if current:
                result.append(current); current = None
            result.append(section)
            continue
        blocks = [{'kind':'text','text': section['heading']}] + section['blocks']
        extra = sum(len(ENC.encode(b['text'])) for b in blocks)
        current_size = sum(len(ENC.encode(b['text'])) for b in current['blocks']) if current else 0
        if current and current_size + extra > 480:
            result.append(current); current = None
        if current is None:
            current = {'heading':section['heading'],'blocks':[], 'page_start':None,'page_end':None}
        current['blocks'].extend(blocks)
    if current:
        result.append(current)
    return result

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    source = json.loads((ROOT / 'data/austra_crawl/knowledge_base.json').read_text(encoding='utf-8'))
    raws = source['documents']
    decisions, candidates = [], []
    for raw in raws:
        state, reason, category = classify(raw)
        decision = {'url': raw['url'], 'category': category, 'decision': state, 'reason': reason}
        decisions.append(decision)
        if state != 'excluded':
            candidates.append((raw, decision))
    # Choose newer upload paths within a policy family; this is a heuristic, not college approval.
    families = defaultdict(list)
    for raw, decision in candidates:
        if raw.get('kind') == 'pdf' and decision['category'] == 'policy':
            families[pdf_family(raw['url'])].append(raw)
    superseded = set()
    for family in families.values():
        current = sorted(family, key=lambda d: ('educert.net' not in d['url'], d['url']), reverse=True)[0]
        superseded.update(d['url'] for d in family if d['url'] != current['url'])
    documents, chunks, fees, review = [], [], [], []
    seen_raw, seen_text = {}, {}
    for raw, decision in sorted(candidates, key=lambda pair: (pair[1]['category'] == 'blog', len(pair[0]['url']), pair[0]['url'])):
        if raw['url'] in superseded or 'educert.net' in raw['url']:
            decision.update(decision='excluded', reason='legacy_or_newer_policy_candidate_exists')
            continue
        if raw.get('sha256') in seen_raw:
            decision.update(decision='excluded', reason='identical_raw_content', duplicate_of=seen_raw[raw['sha256']]['source_url'])
            seen_raw[raw['sha256']]['metadata']['aliases'].append(raw['url'])
            continue
        sections = html_sections(raw) if raw['kind'] == 'html' else pdf_sections(raw)
        title = clean(raw.get('title') or unquote(urlsplit(raw['url']).path.rsplit('/', 1)[-1]).replace('.pdf', '').replace('-', ' '))
        code = COURSE_RE.search(unquote(raw['url']))
        if not code and decision['category'] == 'course':
            code = COURSE_RE.search(title) or COURSE_RE.search(raw.get('text', ''))
        codes = sorted(set(m.upper() for m in COURSE_RE.findall(raw.get('text', ''))))
        primary_code = code.group().upper() if code else None
        text = '\n\n'.join(s['heading'] + '\n' + '\n'.join(b['text'] for b in s['blocks']) for s in sections)
        text_hash = hashlib.sha256(clean(text).encode()).hexdigest()
        if len(clean(text)) < 120:
            decision.update(decision='excluded', reason='insufficient_readable_content')
            continue
        if text_hash in seen_text:
            decision.update(decision='excluded', reason='identical_cleaned_content', duplicate_of=seen_text[text_hash]['source_url'])
            seen_text[text_hash]['metadata']['aliases'].append(raw['url'])
            continue
        flags = []
        if raw.get('needs_ocr'):
            flags.append('some_pdf_pages_have_little_or_no_text')
        if decision['category'] == 'intake':
            flags.append('some_dates_omit_year_do_not_infer')
        if decision['category'] == 'blog':
            flags.append('editorial_source_not_authoritative_for_fees_or_admissions')
        if decision['category'] == 'policy':
            flags.append('version_selected_by_upload_path_requires_staff_review')
        if decision['category'] == 'course' and 'purchase their own' in text.lower() and 'tool kit' in text.lower():
            flags.append('equipment_purchase_and_material_fee_inclusions_need_clarification')
        source_url = raw.get('canonical_url') or raw.get('final_url') or raw['url']
        document = {'id': uid(canonical(raw['url'])), 'source_url': source_url, 'title': title,
            'source_type': raw['kind'], 'category': decision['category'], 'course_code': primary_code,
            'content_hash': text_hash, 'fetched_at': raw.get('fetched_at'),
            'searchable': True, 'review_status': 'pending',
            'metadata': {'aliases': [], 'mentioned_course_codes': codes, 'review_flags': flags,
                         'raw_file': raw.get('raw_file'), 'page_count': raw.get('page_count'),
                         'version_policy': 'crawl snapshot; upload path is not an effective date'},
            'sections': sections}
        seen_raw[raw['sha256']] = document
        seen_text[text_hash] = document
        documents.append(document)
        decision.update(decision='included', document_id=document['id'])
        dedup = set()
        chunk_sections = pdf_chunk_sections(sections) if raw['kind'] == 'pdf' else sections
        if raw['kind'] == 'html' and document['category'] in ('blog','college'):
            chunk_sections = article_chunk_sections(sections)
        for section in chunk_sections:
            for kind, content in chunk_section(document, section):
                h = hashlib.sha256(content.encode()).hexdigest()
                if h in dedup:
                    continue
                dedup.add(h)
                chunks.append({'id': uid(document['id'] + h), 'document_id': document['id'],
                    'chunk_index': len(dedup)-1, 'content': content, 'content_hash': h,
                    'token_count': len(ENC.encode(content)), 'section': section['heading'],
                    'page_start': section['page_start'], 'page_end': section['page_end'],
                    'source_url': document['source_url'], 'title': title, 'category': document['category'],
                    'course_code': section.get('course_code', primary_code),
                    'metadata': {'kind': kind, 'review_flags': flags,
                        **{k: section[k] for k in ('state', 'intake_dates') if k in section}}})
            if primary_code and re.search(r'\bfees?\b', section['heading'], re.I):
                for block in section['blocks']:
                    if block['kind'] == 'table':
                        for row in block['rows']:
                            if len(row) >= 2 and re.search(r'\$[\d,]+', row[-1]):
                                fees.append({'course_code': primary_code, 'label': row[0], 'amount_text': row[-1],
                                    'source_url': document['source_url'], 'section': section['heading'],
                                    'review_status': 'pending', 'currency': 'AUD'})
        if flags:
            review.append({'document_id': document['id'], 'source_url': document['source_url'], 'flags': flags})
    assert all(c['token_count'] <= MAX_TOKENS for c in chunks)
    assert len({c['id'] for c in chunks}) == len(chunks)
    assert all(c['document_id'] in {d['id'] for d in documents} for c in chunks)
    write_jsonl('documents.jsonl', documents)
    write_jsonl('chunks.jsonl', chunks)
    write_json('fee_candidates.json', fees)
    write_json('source_decisions.json', decisions)
    write_json('review_queue.json', review)
    report = {'input_records': len(raws), 'included_documents': len(documents), 'chunks': len(chunks),
        'categories': dict(Counter(d['category'] for d in documents)),
        'excluded_reasons': dict(Counter(d['reason'] for d in decisions if d['decision']=='excluded')),
        'fee_candidates': len(fees), 'review_flagged_documents': len(review),
        'total_embedding_tokens': sum(c['token_count'] for c in chunks),
        'tokenizer': 'cl100k_base', 'max_chunk_tokens': MAX_TOKENS, 'text_overlap_tokens': OVERLAP,
        'median_chunk_tokens': statistics.median(c['token_count'] for c in chunks),
        'maximum_observed_chunk_tokens': max(c['token_count'] for c in chunks),
        'note': 'Snapshot candidates, not staff-approved facts. No embeddings or cloud writes performed.'}
    write_json('preparation_report.json', report)
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
