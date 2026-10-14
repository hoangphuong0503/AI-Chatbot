# Amy — Austra chatbot local demo

## Quick start for this repository

The current stack is React + Express, Supabase cloud, local Ollama **BGE-M3** embeddings, and the Intern AI **deepseek-v4-flash-0731** API for reranking and answers. Retrieval uses BM25 + pgvector → RRF → LLM reranker. The UI and answers are English, with reference panels hidden.

1. Install Node.js 22.12+ and Ollama. Clone this repository and run `npm ci`.
2. Run `ollama pull bge-m3` and keep Ollama running.
3. Create a dedicated Supabase project and run **all five** files in `supabase/migrations` in filename order. Existing installations only need unapplied migrations.
4. Copy `.env.example` to `.env`. Fill `SUPABASE_URL`, backend `SUPABASE_SECRET_KEY`, and `CHAT_API_KEY`. Keep the Ollama and DeepSeek model settings from the example. Do not commit `.env`.
5. Run `npm run check:chat`, `npm run check:embeddings`, then `npm run ingest` to create your local embedding cache and upload the supplied prepared corpus.
6. Set `APP_MODE=cloud` in `.env`, run `npm run build`, then `npm start`. Open `http://127.0.0.1:3001`.

The committed `data/processed` corpus is a public website snapshot. API keys, raw HTML/PDF downloads, generated previews, test response logs and local embedding caches are excluded. Raw archive files referenced in metadata belong to the original local crawl and are not included; to regenerate the data, run the crawling scripts before preparation. Document embeddings are created by ingestion, not by app startup. An application restart clears the in-memory retrieval cache.

For development, `npm run dev` serves the UI at `http://127.0.0.1:5173`. Check changes with `npm test` and `npm run build`. The server currently binds to loopback for a local demo; public hosting requires deployment configuration. Website dates without a year remain uncertain and college staff should review source data before production use.

The remaining sections document the original crawl and optional embedding-provider setup; the BGE-M3 quick start above is the current default.

Local React/TypeScript app and Node backend, prepared for Supabase cloud retrieval: **BM25 + vector search → RRF → DeepSeek LLM reranker → cited answer**. The interface and final answers are English. Chat uses `deepseek-v4-flash-0731` through Intern AI's OpenAI-compatible Chat Completions endpoint, with thinking disabled to keep rewrite/reranking token budgets predictable. Embeddings default to `gemini-embedding-2` at 1536 dimensions, with OpenAI embeddings as an optional alternative. The original crawl is untouched. **Source preview mode** uses local BM25 without API calls.

## Completed locally

- Crawled public Austra HTML and linked PDFs under `data/austra_crawl`.
- Classified and cleaned content; excluded failed pages, theme templates, navigation archives, duplicate content, and selected superseded PDF variants.
- Generated section-aware chunks with source URLs and PDF page numbers. Course code is explicitly included in each course chunk. Tables retain rows, labels, and fee components.
- Generated a staff review queue and extracted fee candidates. These records have not been approved by the college.
- Prepared two Supabase migrations, vector-candidate search, and resumable embedding/import script.
- Added actual BM25 in the local backend, RRF rank fusion, and a DeepSeek LLM relevance reranker with validated candidate IDs and abstention. This reranker is not a cross-encoder model.
- Added local preview UI and RAG backend with source citations, course filters, bilingual query rewriting, request validation and local rate limiting.

## Run the local preview

### Current embedding setup: BGE-M3 locally

Chat, query rewriting and reranking use the DeepSeek API. Embeddings use Ollama `bge-m3`. Start Ollama, run `ollama pull bge-m3` once, and configure `EMBEDDING_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`, and `OLLAMA_EMBEDDING_MODEL=bge-m3` in `.env`.

Run all migration files in filename order for a fresh database. For the existing database with the Nomic migration already applied, run only `supabase/migrations/202610140004_local_bge_m3.sql`. Then run `npm run check:embeddings` and `npm run ingest`. After import, set `APP_MODE=cloud` and restart the app. Ollama must remain available to embed each question; app startup does not embed documents.

BGE-M3 produces 1024 native dimensions. The adapter normalizes these and pads with 512 zeros to fit the existing 1536-dimensional column, preserving cosine similarity. It sends raw text without Nomic prefixes and disables truncation. Model-specific cache keys prevent mixing vector spaces. The Gemini instructions below describe an optional alternative.

References: [Ollama BGE-M3](https://ollama.com/library/bge-m3), [BGE-M3 model card](https://huggingface.co/BAAI/bge-m3), [Ollama embed API](https://docs.ollama.com/api/embed).

Requirements: Node 22.12+ (tested on Node 24), Python 3.11+.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The API runs on `127.0.0.1:3001`. With a production build, `npm run start` serves both at `http://127.0.0.1:3001`.

## Connect Supabase cloud

1. Create a dedicated Supabase project. Use a region suitable for your project.
2. In SQL Editor, run `supabase/migrations/202610140001_knowledge.sql` once, then `supabase/migrations/202610140002_semantic_candidates.sql`. If the first migration already succeeded, only run the second. The second migration adds vector-candidate retrieval and allows Gemini embeddings without changing the 1536-dimensional column or deleting data.
3. Copy `.env.example` to `.env` and populate the backend-only variables:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_BACKEND_SECRET_KEY
CHAT_API_BASE_URL=https://discovery-api.intern-ai.org.cn/v1
CHAT_API_KEY=YOUR_INTERN_AI_KEY
CHAT_MODEL=deepseek-v4-flash-0731
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=YOUR_GOOGLE_AI_STUDIO_KEY
EMBEDDING_RPM=80
APP_MODE=preview
```

Use Supabase's backend **secret key** (typically `sb_secret_...`), not a publishable key. Keep secrets in `.env`; never include them in `VITE_*` variables, source files, browser code, or chat messages. No cloud account has been created or changed by this local work.

4. Check chat and embedding access, inspect `data/processed/preparation_report.json`, then run the dry check and import. Gemini currently advertises an embedding free tier; account access and quota must be checked with your own key. Import uses your provider's quota and may incur charges on a paid tier. The dry check does not make API calls. The prepared tokenizer count is an estimate for Gemini, not Google-billed token usage.

```powershell
npm run check:chat
npm run check:embeddings
npm run ingest:check
npm run ingest
```

The default embedding model is `gemini-embedding-2`, explicitly using 1536 dimensions. Queries use the `task: search result | query:` prefix; documents use the `title: ... | text:` format recommended for Embedding 2. Each chunk is a separate request within synchronous `batchEmbedContents`, preventing accidental aggregation into one vector. Returned vectors are dimension-checked and normalized. Live checks confirmed this batch endpoint and identified a quota of 100 individual embedding inputs/minute for this project's free tier. `EMBEDDING_RPM=80` paces by input count, including inputs inside batches. 429/5xx responses are retried with backoff; pacing does not guarantee account token or daily limits. Existing cached batches survive interruptions.

Vectors are cached in ignored `data/embeddings/cache.json`; interrupted runs reuse saved batches. Cache keys include provider, model, dimensions, retrieval format and content hash. Each document and its chunks are replaced atomically. Final activation disables documents absent from the current snapshot. Use a dedicated project/corpus: activation is global to this knowledge base. Do not run concurrent ingestions. Changing embedding models requires re-embedding the entire corpus; equal dimensions do not mean compatible vector spaces.

5. Set `APP_MODE=cloud` in `.env` and restart `npm run dev`. Test with course codes, Vietnamese/English questions, follow-ups, unknown topics and policy questions. Startup verifies that the local BM25 corpus matches Supabase's active documents, content hashes, chunk count and embedding model. Cloud access, real embeddings, model availability, latency and live answer quality require valid credentials and have not been verified locally.

To try DeepSeek before Supabase/embeddings are ready, set `APP_MODE=local-chat`: only `CHAT_API_KEY` is required. This mode runs local BM25 → DeepSeek reranker → DeepSeek answer; it does not run vector search or RRF. `APP_MODE=preview` runs only BM25 source search, with no AI calls.

For OpenAI embeddings instead of Gemini, set `EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY`; the model becomes `text-embedding-3-small` at 1536 dimensions. Chat still uses the separate Intern AI key. Keys are never copied between providers. The former `OPENAI_CHAT_MODEL` variable is no longer used.

## Rebuild prepared data

Starting or restarting the app does not re-embed documents. `npm run ingest` is a separate setup/update operation and reuses cached document vectors. Cloud chat generates one new query embedding for each question. When website content changes, rerun crawling, preparation and ingestion; changed content gets new cache keys, while unchanged content reuses vectors.

```powershell
python -m pip install -r requirements.txt
python scripts/prepare_knowledge.py
python scripts/verify_processed.py
npm run ingest:check
```

The script uses actual `cl100k_base` token counts, a 650-token maximum including context, and up to 60 tokens of overlap when splitting long text inside a section. HTML FAQs and course sections stay separate to preserve meaning. Small blog/college sections are packed with their headings retained in the body; tables remain separate. PDF clauses on each page are consolidated while preserving clause headings, then split if needed. PDF page boundaries remain intact. Large HTML tables split by rows with header repetition where headers exist. PDF extraction is plain text and does not reliably reconstruct tables, and scanned pages remain flagged. Original files are retained for visual review.

Outputs:

- `documents.jsonl`: curated source records and extracted sections.
- `chunks.jsonl`: chunks ready for embeddings and import.
- `source_decisions.json`: why each input was included or excluded.
- `review_queue.json`: version, OCR, date, or source-authority concerns.
- `fee_candidates.json`: source fee strings, **not approved fee records**.
- `preparation_report.json` and `verification.json`: counts and integrity checks.

## Retrieval behavior

Intake extraction preserves the website's VIC/NSW/SA/WA tab labels, course codes and individual day/month pairs in chunk metadata. Intake retrieval restricts both BM25 and vector candidates to the identified course and requested state (including city aliases such as Adelaide → SA). Dates without an explicit year retain that uncertainty; a state label does not prove available seats. Regression checks cover the SA Glass and Glazing November schedule and separation from VIC/NSW schedules.

Clear standalone English questions and uniquely identified courses bypass the query-rewriting API call. Contextual references such as "that course" retain rewriting. A process-local LRU cache retains successful retrieval and reranking results for ten minutes, up to 200 entries. Keys include the question, corpus content hashes, embedding model, chat model/endpoint and retrieval version. Context-dependent questions also include the last six conversation messages; standalone questions can reuse retrieval across chats. Empty reranks and errors are not cached. The answer is generated afresh on every request using the current history; cached requests skip document search, question embedding and reranking. Restarting the backend clears the cache. Response telemetry reports cache hits, rewrite bypass and retrieval latency.

Cloud retrieval rewrites the question into English while preserving course codes and conversation context. Actual BM25 (k1=1.5, b=0.75) runs over the prepared local corpus with term frequency saturation, inverse document frequency and document length normalization. Supabase pgvector cosine search supplies a separate candidate list. Each branch returns up to 30 candidates; RRF (k=60) merges and selects up to 20. DeepSeek ranks these candidates by relevance and selects up to eight excerpts for the answer. Reranker output must be valid JSON with in-range indices; invalid output fails the request rather than silently skipping reranking. Empty relevant-candidate output causes abstention.

Exact course-code filtering applies when one code is requested. Multi-course comparisons keep both courses eligible. Fee, requirement, duration and policy intents filter out blog sources. BM25 lives in the app rather than requiring a PostgreSQL BM25 extension. The original SQL `hybrid_search` function remains for compatibility, but the runtime no longer uses its Postgres full-text branch as BM25. The request limiter is 15 chat requests/minute; each complete AI answer uses three chat calls (rewrite, rerank, answer), subject to the provider's separate account-wide limits.

Intake records currently use source chunks, with no inferred year or live seat availability. Structured intake/fee tables and SQL lookups are a subsequent step after validation of extracted dates and fee rules. The current cloud demo does not implement authoritative structured fee/intake lookups. PDFs/HTML are archived locally; uploading originals to Supabase Storage is also deferred.

All selected sources are pending staff review. Selection of newer PDF variants relies on upload paths and filename families, not verified effective dates. Crawl date is a snapshot timestamp, not an effective date or evidence of current availability. The assistant is instructed to acknowledge missing/conflicting evidence; this does not replace end-to-end answer evaluation. The demo binds to loopback and is not production-ready authentication or multi-user infrastructure.

## Verification

```powershell
python scripts/verify_processed.py
npm test
npm run build
```

Database tests execute both actual migrations, vector/hybrid queries, embedding-model isolation, RLS/grants, vector dimension validation, rollback, stale-chunk replacement, and snapshot activation in temporary PGlite Postgres with pgvector. Synthetic vectors verify SQL behavior, not real semantic relevance. BM25 and retrieval tests use the prepared Austra corpus. Mock-provider tests verify Chat Completions model routing, key separation, Gemini per-chunk requests, vector validation, RRF and reranker output handling. Supabase-specific cloud behavior and provider endpoints remain to be tested after connection.

References: [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Intern AI endpoint](https://discovery.intern-ai.org.cn/token-plan/home), [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).
