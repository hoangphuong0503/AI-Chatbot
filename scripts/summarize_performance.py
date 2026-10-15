"""Summarize matched cold/warm streaming measurements and fresh quality checks."""
import json
import statistics
from pathlib import Path

OUT=Path(__file__).resolve().parents[1]/'data/test-results'
before=json.loads((OUT/'latency_before.json').read_text(encoding='utf-8'))
after=json.loads((OUT/'latency_after.json').read_text(encoding='utf-8'))
assert len(before['results'])==len(after['results'])==12
paired={}
for phase,report in [('before',before),('after',after)]:
    paired[phase]={(r['name'],r['warm']):r for r in report['results']}
assert paired['before'].keys()==paired['after'].keys()
metrics={}
for warm in [False,True]:
    name='repeat' if warm else 'first_request'
    metrics[name]={phase:{'median_total_ms':statistics.median(r['total_ms'] for r in report['results'] if r['warm']==warm),
        'median_first_token_ms':statistics.median(r['first_token_ms'] for r in report['results'] if r['warm']==warm)}
        for phase,report in [('before',before),('after',after)]}
quality=json.loads((OUT/'performance_quality_after.json').read_text(encoding='utf-8'))
assert quality['completed']==quality['total']==65
summary={'matched_questions':6,'requests_per_phase':12,'metrics':metrics,
    'quality':{'passed':sum(r['passed'] for r in quality['results']),'total':quality['total'],
        'failures':[r['name'] for r in quality['results'] if not r['passed']],
        'targeted_retests':[r['name'] for r in quality['results'] if r.get('initial_attempt')]},
    'limitations':'Small sequential local benchmark; provider load and Ollama residency were not controlled. Fast facts and repeated answers benefit most. Remaining cold hybrid questions still require external DeepSeek calls.'}
lines=['# Chatbot speed and accuracy review','',
    'Matched questions: six, each sent once with a fresh process cache and once as an exact repeat with identical history. Both phases use streaming, the same corpus, BGE-M3 and DeepSeek model. The first-token measurement reflects HTTP token arrival, not browser paint time.','',
    '| Question | Before first/full (s) | After first/full (s) | Repeat full before → after (s) |',
    '|---|---:|---:|---:|']
for name,warm in paired['before']:
    if warm:continue
    b=paired['before'][(name,False)];a=paired['after'][(name,False)]
    bw=paired['before'][(name,True)];aw=paired['after'][(name,True)]
    lines.append(f"| {name} | {b['first_token_ms']/1000:.3f} / {b['total_ms']/1000:.3f} | {a['first_token_ms']/1000:.3f} / {a['total_ms']/1000:.3f} | {bw['total_ms']/1000:.3f} → {aw['total_ms']/1000:.3f} |")
hybrid=[r['duration_ms'] for r in quality['results'] if r.get('retrieval','').startswith('bm25')]
summary['remaining_hybrid']={'count':len(hybrid),'median_ms':statistics.median(hybrid),'maximum_ms':max(hybrid)}
historical_paths=[OUT/'evaluation.json',OUT/'updated_data_evaluation.json']
comparison=''
if all(p.exists() for p in historical_paths):
    historical={r['name']:r for p in historical_paths for r in json.loads(p.read_text(encoding='utf-8'))['results']}
    matched=[(historical[r['name']].get('duration_ms',historical[r['name']].get('total_ms')),r['duration_ms'])
        for r in quality['results'] if r.get('retrieval','').startswith('bm25') and r['name'] in historical]
    old_ms=statistics.median(p[0] for p in matched);new_ms=statistics.median(p[1] for p in matched)
    summary['matched_remaining_hybrid']={'count':len(matched),'before_median_ms':old_ms,'after_median_ms':new_ms}
    comparison=f"For {len(matched)} matched questions that still used hybrid retrieval, the historical API run had a median full-answer time of {old_ms/1000:.1f}s; this run had {new_ms/1000:.1f}s. The historical run was sequential and the new quality suite allowed two active requests, so provider load/concurrency was not a controlled causal experiment."
(OUT/'performance_summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
lines += ['',summary['limitations'],'',
    'The largest improvement comes from quoting validated source facts for simple duration/IELTS/form-frequency questions and serving completed, grounded repeated answers. Independent named-form queries skip rewriting. The BM25/vector candidate counts, RRF and separate DeepSeek reranker remain for complex questions. No new embedding or database migration was required.','',
    'An initial shortened form answer omitted its legacy status. A source-metadata guard now preserves that caveat in both streamed output and completed-answer cache entries; a dedicated regression verifies this. The successful benchmark was rerun after this correction.','',
    'The first quality pass also caught an omitted Date label in a signature field group. A strict source lookup now returns both complete Compiled By / Signature / Date and Reviewed By / Signature / Date groups. That failed case was rerun successfully; its original failed response remains in the JSON report. The field-listing prompt also explicitly preserves associated dates.','',
    f"In the 65-case quality run (up to two concurrent requests), remaining hybrid full-answer latency had a median of {statistics.median(hybrid)/1000:.1f}s and a maximum of {max(hybrid)/1000:.1f}s. External DeepSeek latency still causes outliers. These non-streaming full-answer times are separate from the sequential streaming benchmark above.",'',
    comparison,'',
    f"## Accuracy: {summary['quality']['passed']}/65 fresh cases passed",'',
    'The initial quality run began after a process restart. Every case made a fresh local API request; prior-turn evaluation results were not reused. One failed field-group case was corrected and retested. It covers course fees and duration, IELTS/ELICOS conditions, state/year/variant intake matching, policies, new OCR forms, unknown records and payment options. Passing the specified assertions is not proof of every possible question.','']
for r in quality['results']:
    result=r if r['passed'] else r.get('result') or {}
    lines += [f"### {'PASS' if r['passed'] else 'FAIL'} — {r['name']}",'',r['question'],'',result.get('answer','No answer'),'']
    if not r['passed']:lines += [r.get('error','Failed'),'']
    lines += [f"- [{s['title']}]({s['url']})" for s in result.get('sources',[])]
    lines.append('')
(OUT/'performance_review.md').write_text('\n'.join(lines),encoding='utf-8')
print(json.dumps(summary,indent=2))
