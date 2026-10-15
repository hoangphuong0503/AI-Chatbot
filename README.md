# Amy — Austra study assistant

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
- Other questions use BM25 + Supabase cosine vector search → RRF (k=60, top 20) → DeepSeek relevance reranker (up to 8) → concise DeepSeek answer. This is an LLM reranker, not a dedicated cross-encoder.

The ten-minute, 200-entry process-local LRU cache stores successful search/rerank results, not final answers. Context-dependent questions include history in the key. Keys include the corpus snapshot, models, endpoint and retrieval version. Empty reranks/errors are not cached. Restarting clears it. Structured lookups need no model calls.

## Streaming, health and diagnostics

The browser requests `POST /api/chat` with `{question, history, stream: true}`. The API sends newline-delimited JSON `status`, `token`, `done` and `error` events with heartbeats. `stream: false` (default) retains ordinary JSON compatibility. Only complete answers enter chat history; interrupted/failed streams can be retried. Stop aborts the browser request and propagates cancellation to model calls. The UI hides numbered references/source panels while the API retains provenance for verification.

`GET /api/health` runs real Supabase snapshot/model inventory checks, an embedding inference probe, and a short chat inference probe. It returns 503 with per-service status when unhealthy. Healthy checks are shared/cached for 60 seconds; failures retry after five seconds. The UI refreshes status every 30 seconds. Probes consume a small amount of provider quota. Health confirms recent connectivity, not future quota or response correctness.

Responses include per-stage timings: rewrite, BM25, embedding, vector query, reranker, answer generation, first token and total. Operational console logs include timings and error type/status only, never API keys, question text or conversation content. Full local evaluation outputs are ignored by Git.

## Data and embeddings

The repository includes the curated public snapshot in `data/processed`: 111 documents and 2,149 chunks. Raw downloaded HTML/PDFs, API credentials, embedding caches and test response logs are excluded from Git. Archive paths in metadata refer to the original local crawl and are not included.

Chunks preserve headings, course identity, HTML fee tables and PDF page provenance. Intake extraction preserves VIC/NSW/SA/WA tab labels, variant headings and individual date pairs. Sources still require staff review: some PDFs need OCR, document versions rely on filename/upload-path heuristics, and fee/material inclusions can conflict. Original raw files are retained locally for review.

BGE-M3 returns 1024 native dimensions. Normalized vectors are padded with 512 zeros for the existing 1536-dimensional Supabase column; cosine similarity is preserved. BGE-M3 receives raw text with truncation disabled. Model-specific cache keys prevent mixing vector spaces. Gemini/OpenAI are optional embedding providers with separate credentials, but switching providers requires re-embedding the entire corpus. Chat remains on the separate DeepSeek API.

`npm run ingest` is a separate, resumable operation. Cached document vectors are reused, each document/chunk replacement is atomic, and snapshot activation occurs after all documents finish. Use a dedicated corpus/project and do not run concurrent ingestions. A running app should be restarted after ingestion so local BM25 and Supabase reflect the same snapshot.

To rebuild the crawl locally:

```powershell
python -m pip install -r requirements.txt
python scripts/crawl_austra.py
python scripts/collect_linked_external_pdfs.py
python scripts/prepare_knowledge.py
python scripts/verify_processed.py
npm run ingest
```

## Verification

```powershell
npm test
npm run build
npm run evaluate
npm run test:stream
```

`npm test` runs offline regression tests, including 40 realistic evaluation cases, actual SQL migrations in PGlite/pgvector, ranking, policy scope, state/course switches, fee arithmetic, missing years, service outage/recovery and stream interruption/UTF-8 parsing. It needs the prepared corpus, not live credentials.

`npm run evaluate` runs those 40 questions through the running local API with the configured real providers, pacing requests to respect the local limit. Reports are written to `data/test-results/evaluation.json`. These assertions check specified facts/sources/abstentions; passing is not a guarantee that every generated sentence is correct. `npm run test:stream` separately verifies incremental upstream model tokens and records first-token/total latency. Live tests consume the configured provider's quota. The 15-requests/minute app limiter is process-local and is not a substitute for production abuse protection.
