"""Combine fresh live API evaluations into a reviewable local answer report."""
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import statistics
import re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'data/test-results'
reports = [json.loads((OUT/name).read_text(encoding='utf-8')) for name in
    ['evaluation.json','updated_data_evaluation.json']]
assert all(r['completed'] == r['total'] for r in reports), 'Evaluations are incomplete'
assert not any(r.get('reused_from') for report in reports for r in report['results'])
results = [r for report in reports for r in report['results']]
payment_path=OUT/'payment_plans_retest.json'
if payment_path.exists():
    payments=json.loads(payment_path.read_text(encoding='utf-8'))['results']
    assert len(payments)==3 and all(r['passed'] for r in payments)
    results.extend({'name':'Payment arrangements: '+r['question'],'group':'payments',**r} for r in payments[1:])
questions = dict(re.findall(r"name:'([^']+)',question:'([^']+)'", (ROOT/'tests/evaluation-cases.ts').read_text(encoding='utf-8')))
for r in results:
    r.setdefault('question',questions.get(r['name'],'See the evaluation case definition.'))
failures = [r for r in results if not r['passed']]
timings = {}
for kind in ['structured','hybrid']:
    selected = [r for r in results if r['passed'] and
        r.get('retrieval','').startswith('structured-') == (kind=='structured')]
    ms = [r.get('duration_ms',r.get('total_ms')) for r in selected]
    if ms:
        timings[kind] = {'count':len(ms),'median_ms':round(statistics.median(ms)), 'maximum_ms':max(ms)}
summary = {'created_at':datetime.now(timezone.utc).isoformat(), 'total':len(results),
    'passed':len(results)-len(failures),'failed':len(failures),'timings':timings,
    'failure_names':[r['name'] for r in failures],
    'note':'Live endpoint assertions plus recorded answers for manual review; passing checks do not prove every generated claim.'}
(OUT/'chatbot_review_summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
lines = ['# Chatbot evaluation with updated corpus', '',
    f"Passed {summary['passed']}/{summary['total']} live test cases. Failed: {summary['failed']}.", '',
    'All cases ran afresh against the local API with configured Supabase, local BGE-M3 and DeepSeek.', '',
    'Checks cover specified facts, selected sources, context changes and abstention. Full answers below support manual review.', '']
for r in results:
    if r.get('manual_review'):
        lines += ['## Issue found and corrected', '',r['manual_review'], '',
            'Initial answer: '+r['initial_attempt']['answer'], '', 'Retested answer: '+r['answer'], '']
    elif r.get('initial_attempt') and r['name']=='no fabricated contract decision':
        lines += ['## Test assertion correction', '',
            'The first answer correctly said the form does not state whether the named agency was renewed or terminated. A broad forbidden-substring assertion matched that negated phrase. The assertion was narrowed to standalone positive statements, and a new live request passed. The original failed assertion and answer remain in the JSON report.', '']
lines += ['## Operational observation', '',
    'One additional-suite preflight returned ready=false and stopped before sending test questions. A new health probe recovered with Supabase, DeepSeek and local embeddings all healthy; the suite was restarted. The first assertion did not record the per-service failure reason, so no provider-specific cause is asserted.', '',
    'Response-time figures are non-streaming full-answer latency on this local machine and shared API endpoint, not time to the first visible streamed token.', '']
for r in results:
    result = r if r['passed'] else (r.get('result') or {})
    lines += [f"## {'PASS' if r['passed'] else 'FAIL'} — {r['name']}", '',
        r.get('question','See tests/evaluation-cases.ts for the exact question.'), '', result.get('answer','No answer'), '']
    if not r['passed']:lines += ['Failure: '+r.get('error','Unknown'), '']
    for s in result.get('sources',[]):lines.append('- '+s['url'])
    lines.append('')
(OUT/'chatbot_review.md').write_text('\n'.join(lines),encoding='utf-8')
print(json.dumps(summary,indent=2))
