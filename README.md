# Amy — Austra study assistant

> New to the project? Start with the [plain-English App Overview](docs/APP_OVERVIEW.md): Amy's purpose, features, data, technology and how it works. For website integration, see the [Website Launch Guide](docs/WEBSITE_LAUNCH_GUIDE.md).

An English chat interface for Austra College's public website. React + Express run locally, Supabase stores vectors, Ollama **BGE-M3** generates embeddings, and Intern AI **deepseek-v4-flash-0731** handles query rewriting, relevance reranking and streamed answers.

## Setup

Requirements: Node.js 22.12+ and Ollama. Python 3.11+ is needed only to crawl/rebuild the prepared data.

1. Clone this repository and run `npm ci`.
2. Run `ollama pull bge-m3` and keep Ollama running (`ollama serve` if the desktop service is not running).
3. Create a dedicated Supabase project. In SQL Editor, run the five SQL files in `supabase/migrations` in filename order. Existing installations need only unapplied migrations.
4. Copy `.env.example` to `.env`. Fill `SUPABASE_URL`, backend `SUPABASE_SECRET_KEY` and `CHAT_API_KEY`. Keep the BGE-M3 and DeepSeek defaults. Never commit `.env` or place secrets in `VITE_*` variables.
5. Run `npm run check:chat`, `npm run check:embeddings`, `npm run ingest:check`, then `npm run ingest`.
6. Set `APP_MODE=cloud` in `.env`. Run `npm run build` then `npm start`. Open **http://127.0.0.1:3001**.

`npm run dev` starts the UI at http://127.0.0.1:5173 and the API at port 3001. The production build is served by Express on port 3001. Both servers bind to loopback for the local demo. Public deployment needs explicit host/proxy configuration, access controls, budget/concurrency controls and load testing.

`APP_MODE=preview` searches local sources without AI. `APP_MODE=local-chat` uses local BM25 and DeepSeek without vector search. `APP_MODE=cloud` uses the full stack. Ollama is required for new hybrid query embeddings, not for document embedding at every startup.

## Answer routing and context

- Deterministic planning resolves course names/codes, states/city aliases and conversational references. Explicit changes override earlier course/state choices. Unrelated topics must not inherit a previous course fee.
- College-wide policies do not receive a course-code restriction: asking about refunds for a particular course must retain the college's policy evidence.
- Simple fee questions use the course's extracted fee table. Numeric components must reconcile with the listed total. Conflicting/complex fee scenarios fall back to evidence-based answering, not guessed arithmetic.
- Intake questions use extracted state + course + date records. Code filters the requested month/year and selects the earliest listed date. Missing state/course, multiple streams and omitted years trigger clarification. No year is inferred, and a listed date never proves available seats. These are snapshot lookups, not live admissions decisions.
- Simple duration questions quote one unambiguous course section, preserving holidays, placement and conditional package options. Simple IELTS questions read the source score/ELICOS table and offshore result-validity condition. Unknown qualifiers, malformed tables and personal eligibility scenarios retain the full retrieval path. The audited Change of Details frequency instruction and exact performance-form signature/date groups also have narrow direct lookups.
- Other questions use BM25 + Supabase cosine vector search → RRF (k=60, top 20) → DeepSeek relevance reranker (up to 8) → concise DeepSeek answer. This is an LLM reranker, not a dedicated cross-encoder.

Two process-local LRU caches each hold up to 200 entries for ten minutes. Retrieval caching stores successful search/rerank results; context-dependent queries include history. Completed-answer caching always includes the full history supplied to generation, even for standalone questions. Keys include the corpus snapshot, models, endpoint and retrieval/answer version. Errors, missing-evidence replies and cancelled/incomplete generations do not populate the completed-answer cache. An exact repeat with identical context can return the finished answer and its original provenance immediately. Restarting clears both caches. Structured lookups need no model calls.

Independent named-form questions skip query rewriting; references and non-English inputs retain it. Generated answers focus on the requested facts while preserving conditions. A deterministic metadata check appends the legacy-form caveat if the model omits it, including in streamed output and cached completions. Candidate counts, RRF and the separate DeepSeek relevance reranker are retained for hybrid questions.

## Streaming, health and diagnostics

The browser requests `POST /api/chat` with `{question, history, stream: true}`. The API sends newline-delimited JSON `status`, `token`, `done` and `error` events with heartbeats. `stream: false` (default) retains ordinary JSON compatibility. Only complete answers enter chat history; interrupted/failed streams can be retried. Stop aborts the browser request and propagates cancellation to model calls. The UI hides numbered references/source panels while the API retains provenance for verification.

`GET /api/health` runs real Supabase snapshot/model inventory checks, an embedding inference probe, and a short chat inference probe. It returns 503 with per-service status when unhealthy. Healthy checks are shared/cached for 60 seconds; failures retry after five seconds. The UI refreshes status every 30 seconds. Probes consume a small amount of provider quota. Health confirms recent connectivity, not future quota or response correctness.

Responses include per-stage timings: rewrite, BM25, embedding, vector query, reranker, answer generation, first token and total. Operational console logs include timings and error type/status only, never API keys, question text or conversation content. Full local evaluation outputs are ignored by Git.

## Data and embeddings

The repository includes the curated public snapshot in `data/processed`: 114 documents and 2,117 chunks. Raw downloaded HTML/PDFs, API credentials, embedding caches and test response logs are excluded from Git. Archive paths in metadata refer to the original local crawl and are not included.

Chunks preserve headings, course identity, HTML fee tables and PDF page provenance. Intake extraction preserves VIC/NSW/SA/WA tab labels, variant headings and individual date pairs. Sources still require staff review: document versions rely on filename/upload-path heuristics, and fee/material inclusions can conflict. Original raw files are retained locally for review.

The 15 October audit refreshed the redirected trade courses overview, recovered the short Change of Details instruction, added the legacy Policies & Forms directory and two linked agent review forms. The scanned performance form was OCRed locally and checked against both rendered pages. Legacy forms describe blank fields, not completed evaluations or current policy approval. Twelve thin pages remain excluded because they expose only titles, broken shortcodes or no distinct form content. Five original failed URLs remain unavailable; this update does not claim complete coverage of text inside every website image.

`data/source_updates/overrides.json` is applied over the immutable archive during preparation. It retains source URLs, hashes, page numbers and review flags. `thin_pages_review.json` records all 14 dispositions; `agent_performance_ocr.json` retains raw OCR boxes/confidence and reviewed text. Local raw HTML/rendered PNG evidence is excluded from Git. To repeat the refresh with the original crawl present, install `requirements-ocr.txt`, run `python scripts/refresh_reviewed_sources.py`, then prepare, verify and ingest. Repeating the refresh performs new public HTTP requests and local OCR.

BGE-M3 returns 1024 native dimensions. Normalized vectors are padded with 512 zeros for the existing 1536-dimensional Supabase column; cosine similarity is preserved. BGE-M3 receives raw text with truncation disabled. Model-specific cache keys prevent mixing vector spaces. Gemini/OpenAI are optional embedding providers with separate credentials, but switching providers requires re-embedding the entire corpus. Chat remains on the separate DeepSeek API.

`npm run ingest` is a separate, resumable operation. Cached document vectors are reused, each document/chunk replacement is atomic, and snapshot activation occurs after all documents finish. Use a dedicated corpus/project and do not run concurrent ingestions. A running app should be restarted after ingestion so local BM25 and Supabase reflect the same snapshot.

To rebuild the crawl locally:

```powershell
python -m pip install -r requirements.txt
python scripts/crawl_austra.py
python scripts/collect_linked_external_pdfs.py
python scripts/prepare_knowledge.py
python scripts/verify_processed.py
python scripts/verify_source_updates.py
npm run ingest
```

## Verification

```powershell
npm test
npm run build
npm run evaluate
npx tsx scripts/evaluate_updated_data.ts
npm run test:stream
```

`npm test` runs offline regression tests, including 40 realistic evaluation cases, actual SQL migrations in PGlite/pgvector, ranking, policy scope, state/course switches, fee arithmetic, missing years, service outage/recovery and stream interruption/UTF-8 parsing. It needs the prepared corpus, not live credentials.

`npm run evaluate` runs those 40 questions through the running local API with the configured real providers, pacing requests to respect the local limit. Reports are written to `data/test-results/evaluation.json`. These assertions check specified facts/sources/abstentions; passing is not a guarantee that every generated sentence is correct. `npm run test:stream` separately verifies incremental upstream model tokens and records first-token/total latency. Live tests consume the configured provider's quota. The 15-requests/minute app limiter is process-local and is not a substitute for production abuse protection.

`scripts/evaluate_updated_data.ts` adds 23 live course, fee and form cases, including OCR field/version checks and refusal to invent filled agent records. `--retry-failed` preserves successful cases and records previous failed attempts when retrying. `scripts/retest_payment_plans.ts` checks three course-specific payment questions and records the original baseline response alongside its correction. Once reports are complete, `python scripts/summarize_chat_evaluation.py` writes a combined local review with answers, sources and latency. Generated reports are ignored by Git.

`scripts/benchmark_latency.ts --phase=before` and `--phase=after` record matched streaming first-token/full-answer times and exact repeats. Restart the server before each phase to clear process caches. `scripts/evaluate_performance_quality.ts` reruns all 65 live cases, with at most two active requests and one shared launch interval below the local rate limit. `python scripts/summarize_performance.py` combines those measurements and quality results in `data/test-results/performance_review.md`. API load and Ollama residency can vary; the small benchmark is not a latency guarantee for every question. Main benefits are avoiding model calls for validated facts and repeated identical contexts.

Payment-plan and instalment questions retain college-wide sources even when a course is named. The course identity remains available to the answer model, and ordinary fee questions still use their course filter. This avoids unsupported abstention caused by dropping the college's weekly, fortnightly and monthly payment information.
