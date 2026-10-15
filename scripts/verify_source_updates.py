"""Verify the audited additions and preserve existing structured course facts."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def load(path):
    return json.loads((ROOT/path).read_text(encoding='utf-8'))
def rows(path):
    return [json.loads(line) for line in (ROOT/path).read_text(encoding='utf-8').splitlines()]

docs = rows('data/processed/documents.jsonl')
chunks = rows('data/processed/chunks.jsonl')
review = load('data/source_updates/thin_pages_review.json')
assert len(review) == 14
assert sum(r['decision']=='retain_exclusion' for r in review) == 12
assert len([d for d in docs if d['category']=='course']) == 24
assert len(load('data/processed/fee_candidates.json')) == 96
assert len([s for d in docs for s in d['sections'] if s.get('intake_dates')]) == 44
overview = next(d for d in docs if '/trade-courses-in-australia' in d['source_url'])
assert sum('/trade-courses-in-australia' in d['source_url'] for d in docs) == 1
assert not any(d['source_url'].rstrip('/') == 'https://austra.edu.au/courses' for d in docs)
assert 'trade courses in Australia' in str(overview['sections'])
details = next(d for d in docs if '/change-of-details-form/' in d['source_url'])
assert 'every 6 months or when a change occurs' in str(details['sections'])
directory = next(d for d in docs if '/policies-forms/' in d['source_url'])
assert 'legacy_directory_links_not_current_policy_approval' in directory['metadata']['review_flags']
form = next(d for d in docs if d['source_url'].endswith('/Education-Agent-Performance-Review-Form.pdf'))
form_chunks = [c for c in chunks if c['document_id']==form['id']]
assert {c['page_start'] for c in form_chunks} == {1,2}
body = '\n'.join(c['content'] for c in form_chunks)
assert all(t in body for t in ['Department of Home Affairs','ESOS Act','Reviewed By','04/09/2023','Legacy blank form'])
assert not any('contact-form-7' in c['content'] for c in form_chunks)
assert all('legacy_2023_form_confirm_current_version_with_college' in c['metadata']['review_flags'] for c in form_chunks)
print(json.dumps({'reviewed_pages':14,'retained_exclusions':12,'course_count':24,
    'intake_records':44,'fee_candidates':96,'ocr_pages_verified':2,'documents':len(docs),'chunks':len(chunks)},indent=2))
