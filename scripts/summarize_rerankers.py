"""Summarize fresh before/after quality and latency; never hide failed cases."""
import json
import statistics
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'data/test-results'
before, after = [json.loads((root / f'reranker_{phase}.json').read_text(encoding='utf8')) for phase in ['llm', 'local']]
assert before['completed'] == before['total'] == after['completed'] == after['total'] == 65
assert all(before[key] == after[key] for key in ['snapshot', 'chat_model', 'embedding_model'])
old = {r['name']: r for r in before['results']}
new = {r['name']: r for r in after['results']}
assert old.keys() == new.keys()
hybrid = [name for name, row in old.items() if row['candidates']]


def metrics(report):
    rows = [report[name] for name in hybrid if report[name].get('timings')]
    return {'measured': len(rows), **{key: round(statistics.median(r['timings'][key] for r in rows), 1)
                                    for key in ['rerank_ms', 'time_to_first_token_ms', 'total_ms']},
            'max_total_ms': max(r['timings']['total_ms'] for r in rows)}


summary = {'cases_per_phase': 65, 'hybrid_cases': len(hybrid),
           'quality': {phase: {'passed': sum(r['passed'] for r in report['results']),
                               'failures': [r['name'] for r in report['results'] if not r['passed']]}
                       for phase, report in [('llm', before), ('local', after)]},
           'hybrid_latency': {'llm': metrics(old), 'local': metrics(new)},
           'identical_candidate_order': sum(old[n]['candidate_ids'] == new[n]['candidate_ids'] for n in hybrid),
           'local_startup_ms': after['warmup_ms']}
replay_file = root / 'reranker_replay.json'
if replay_file.exists():
    replay = json.loads(replay_file.read_text(encoding='utf8'))
    summary['same_candidate_replay'] = {'cases': len(replay['results']),
        'llm_median_ms': statistics.median(r['baseline_rerank_ms'] for r in replay['results']),
        'local_median_ms': statistics.median(r['local_rerank_ms'] for r in replay['results'])}
(root / 'reranker_summary.json').write_text(json.dumps(summary, indent=2), encoding='utf8')
lines = ['# Local reranker comparison', '',
         'Same 65 questions and conversation histories; same corpus, BGE-M3 embeddings, Supabase and DeepSeek answer model. Each question gets a new engine, so retrieval/answer caches cannot explain the differences. Requests are sequential. Models are prewarmed; startup is reported separately. Times below come from engine instrumentation and streamed token callbacks, not browser paint.', '',
         'The baseline ran first and the local phase second. External provider load was not controlled. The replay additionally scores exactly the baseline RRF inputs to isolate local ranking time. Accuracy means the specified fact/source/abstention assertions passed, not proof of every sentence or every possible query.', '',
         f"Quality: LLM {summary['quality']['llm']['passed']}/65; local {summary['quality']['local']['passed']}/65.", '',
         'Manual spot checks retained the correct tuition/total comparison, four campus addresses, weekly/fortnightly/monthly payment choices, OCR rating/identity/version fields and legacy caveats. Both unsupported agent-record questions stayed blank/unconfirmed, and the Application Leave Form reply did not substitute another form. A remaining limitation appears in both phases: the refund follow-up uses a 95% shorthand while other retrieved policy excerpts specify a 5%-or-$500 cap. The existing refund assertions are broad and do not certify that every refund condition is represented correctly; this comparison leaves the answer model/prompt unchanged.', '',
         'Initial retrieval-only trials found false abstentions at raw score 0. The final local adapter removes LLM-only metadata labels and uses raw cutoff -5; this was checked on this limited corpus, not calibrated as a probability. Those diagnostic runs remain in the local result folder. Model weights were checked against the pinned SHA-256. GPU measurement used RTX 2080 with CUDA FP16; cold Python/model startup was about 19 seconds and is excluded from warmed request medians.', '',
         '## Median latency for questions that use hybrid retrieval', '',
         '| Stage | LLM (s) | Local (s) |', '|---|---:|---:|']
for key, label in [('rerank_ms', 'Reranking'), ('time_to_first_token_ms', 'First answer token'), ('total_ms', 'Complete answer')]:
    lines.append(f"| {label} | {metrics(old)[key] / 1000:.3f} | {metrics(new)[key] / 1000:.3f} |")
lines += ['', f"Identical candidate order: {summary['identical_candidate_order']}/{len(hybrid)} hybrid questions. Different rewrites may change candidate order between phases.", '',
          '## Per-question results', '', '| Question | Before first/full (s) | After first/full (s) | Before/after assertions |', '|---|---:|---:|---|']
for name in hybrid:
    b, a = old[name], new[name]
    def timing(row):
        t = row.get('timings', {})
        return f"{t.get('time_to_first_token_ms', 0) / 1000:.3f} / {t.get('total_ms', 0) / 1000:.3f}"
    lines.append(f"| {name} | {timing(b)} | {timing(a)} | {'PASS' if b['passed'] else 'FAIL'} / {'PASS' if a['passed'] else 'FAIL'} |")
lines += ['', '## Answers for manual review', '']
for name in hybrid:
    lines += [f'### {name}', '', old[name]['question'], '', '**Before**', '', old[name].get('answer', old[name]['error']), '',
              '**After**', '', new[name].get('answer', new[name]['error']), '']
    if not new[name]['passed']:
        lines += ['**Failure:** ' + new[name]['error'], '']
(root / 'reranker_review.md').write_text('\n'.join(lines), encoding='utf8')
print(json.dumps(summary, indent=2))
