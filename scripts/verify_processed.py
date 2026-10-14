"""Check provenance, token limits, table integrity, course identity and safe exclusions."""
import json
from pathlib import Path
import tiktoken

root = Path(__file__).resolve().parents[1] / 'data/processed'
docs = [json.loads(l) for l in (root/'documents.jsonl').read_text(encoding='utf-8').splitlines()]
chunks = [json.loads(l) for l in (root/'chunks.jsonl').read_text(encoding='utf-8').splitlines()]
enc = tiktoken.get_encoding('cl100k_base')
assert len({d['id'] for d in docs}) == len(docs)
assert len({c['id'] for c in chunks}) == len(chunks)
ids = {d['id'] for d in docs}
for c in chunks:
    assert c['document_id'] in ids
    assert len(enc.encode(c['content'])) == c['token_count'] <= 650
    assert c['source_url'].startswith(('https://austra.edu.au/', 'https://educert.net/'))
    if c['category'] == 'course':
        assert c['course_code'] and f"Course code: {c['course_code']}" in c['content']
    assert '/tag/' not in c['source_url'] and '/portfolio/' not in c['source_url']
assert not any('/2025/07/RTO-CRICOS-Student-Handbook-1.pdf' in d['source_url'] for d in docs)
fees = [c for c in chunks if c['course_code']=='SIT30821' and c['section'].endswith('Fees')]
assert len(fees)==1 and all(v in fees[0]['content'] for v in ('$15,500','$500','$1,500','$17,500'))
bsb = next(d for d in docs if d['source_url'].endswith('/diploma-of-leadership-and-management/'))
assert bsb['course_code']=='BSB50420'
report={'documents':len(docs),'chunks':len(chunks),'provenance_checked':True,
    'token_limits_checked':True,'cookery_fee_table_intact':True,'obsolete_handbook_excluded':True,
    'primary_course_code_checked':True}
(root/'verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
