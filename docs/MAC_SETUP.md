# Run the current Amy app on a Mac

This guide sets up the English chat app, **local BGE reranker**, **BGE-M3 embeddings through Ollama**, DeepSeek answers and Supabase search. Your Mac runs the two search models; DeepSeek and Supabase still require internet access.

The local-reranker implementation is now included in this repository. Model weights, API keys and the developer's Python environment are not included: you install/download them on your own Mac.

## 1. Check your Mac and install the tools

Open **Terminal** and run:

```bash
uname -m
```

- `arm64`: Apple Silicon (M series). Use a native Apple Silicon Python installation, not a Terminal/Python running under Rosetta.
- `x86_64`: Intel Mac, or an Apple Silicon Mac using Rosetta. Check **Apple menu → About This Mac** if unsure.

Install these from their official websites:

- [Node.js](https://nodejs.org/) — version 22.12 or newer supported LTS.
- [Python](https://www.python.org/downloads/macos/) — use **Python 3.11** for the instructions below.
- [Ollama for Mac](https://ollama.com/download/mac) — open the app after installing it.
- Git, if `git --version` is unavailable. macOS may offer to install its command line tools.

Ollama currently requires **macOS 14 or newer**. Apple M-series Macs support CPU/GPU operation; Intel Macs use CPU. See [Ollama's requirements](https://docs.ollama.com/macos).

Allow several GB for model files and Python packages. **16 GB RAM or more is recommended** for running both models comfortably; this is a practical recommendation, not a measured minimum for every Mac.

## 2. Download the code

```bash
git clone https://github.com/hoangphuong0503/AI-Chatbot.git
cd AI-Chatbot
npm ci
```

If you already cloned it and have no local changes you need to merge:

```bash
git pull --ff-only
npm ci
```

Run all remaining commands from the `AI-Chatbot` folder.

## 3. Create a private Python environment

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-reranker.txt
```

The requirements select the appropriate stack automatically:

| Mac | Local reranker |
|---|---|
| Apple Silicon | Current supported PyTorch range; automatically selects Apple MPS GPU when available |
| Intel | Legacy PyTorch 2.2.2 CPU wheels with Transformers 4.51.3 and NumPy below 2 |

Intel support uses older libraries because official newer PyTorch wheels are not published for Intel macOS. It is a compatibility path, not a claim of equal speed or current upstream support. If installation fails, do not force-install an incompatible wheel; check the CPU/Python architecture and report the error.

The app prefers the Python executable in `.venv` automatically. You do not need the Windows Python path used by the original developer. When reopening Terminal for Python commands, activate it again with `source .venv/bin/activate`.

## 4. Download the two local models

Keep the Ollama app running, then:

```bash
ollama pull bge-m3
python scripts/download_reranker.py
```

These are **different models**:

- Ollama's `bge-m3` creates embeddings for searching.
- `BAAI/bge-reranker-v2-m3` selects the most relevant search results. Its pinned weights are approximately **2.3 GB**, downloaded into `data/models/bge-reranker-v2-m3` and checked with SHA-256.

Wait for both downloads to finish. Neither model needs to be downloaded again on every app start.

## 5. Set your private configuration

For a new installation:

```bash
cp .env.example .env
```

If `.env` already exists, edit it instead of overwriting your settings. Open `.env` in a text editor and use:

```dotenv
APP_MODE=cloud
RERANKER_PROVIDER=local
RERANKER_PYTHON=
LOCAL_RERANKER_DEVICE=auto
EMBEDDING_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=bge-m3
```

Keep the supplied reranker model, revision, threshold and DeepSeek model defaults. Fill these three private values:

| Setting | Where it comes from |
|---|---|
| `CHAT_API_KEY` | Your authorised key for the configured Intern AI/DeepSeek service |
| `SUPABASE_URL` | Your development Supabase project's API URL |
| `SUPABASE_SECRET_KEY` | That project's backend secret key; never a frontend/public key |

Use an approved **development** project. Do not publish `.env`, put keys in browser code, or copy someone else's production credentials. Downloading the repository does not grant access to the original database or AI account.

Leaving `RERANKER_PYTHON` blank lets the app find `.venv/bin/python`. If using another environment, set the absolute path to its Python executable, without putting shell commands in this setting.

## 6. Prepare Supabase once

**If the owner has provided a development project already containing the matching prepared data and BGE-M3 vectors:** skip this step. Do not re-import or replace a shared project's data without coordinating with its owner.

**For your own new Supabase project:** open its SQL Editor and run these files in order:

1. `supabase/migrations/202610140001_knowledge.sql`
2. `supabase/migrations/202610140002_semantic_candidates.sql`
3. `supabase/migrations/202610140003_local_nomic.sql`
4. `supabase/migrations/202610140004_local_bge_m3.sql`
5. `supabase/migrations/202610140005_safe_snapshot.sql`

Then run:

```bash
npm run ingest:check
npm run ingest
```

The first command only checks the prepared data. The second creates document embeddings locally and uploads them to **the project configured in `.env`**. This first import can take time. Keep Ollama running and wait until activation completes. Start/restart the app after ingestion.

The prepared public documents are already included. You do not need to crawl the website or install the OCR tools just to run this snapshot.

## 7. Check the services and start Amy

```bash
npm run check:reranker
npm run check:embeddings
npm run check:chat
npm test
npm run build
npm start
```

`check:reranker` reports `ready: true` and a device: `mps` on a compatible Apple GPU, or `cpu`. It does not require a chat API key when the local provider is selected. It also checks a real relevance prediction, not just package installation.

Open **http://127.0.0.1:3001**. Keep that Terminal window and Ollama running. Use **Control+C** in the server Terminal to stop Amy. For later runs, use `npm start` from the project folder; re-download/import is unnecessary unless something changed.

The health check can take up to a minute while the local model initializes. A successful health check confirms service connectivity, not correctness of every answer.

Try these questions:

- How much does SIT30821 cost?
- What are the November intake dates for MSF30422 in SA?
- Does SIT30821 offer a payment plan?
- List the rating choices in the Education Agent Performance Review Form.

## Troubleshooting

| Problem | What to check |
|---|---|
| `python3.11` is missing | Install Python 3.11; open a new Terminal and check `python3.11 --version` |
| Python or torch installation fails | Check `uname -m`, Python's architecture and whether `.venv` was created with the intended Python version |
| Local reranker fails on MPS | Set `LOCAL_RERANKER_DEVICE=cpu` in `.env`, restart and rerun `check:reranker`; it still runs locally |
| Too much memory is used | Close other heavy apps; try CPU mode. Both models still require memory, and CPU mode may be slower |
| Embedding service is unavailable | Open Ollama, confirm `ollama list` includes `bge-m3`, then rerun `check:embeddings` |
| Supabase is unavailable | Check URL/key, all migrations, matching snapshot and completed ingestion |
| DeepSeek is unavailable | Check the configured service/key, model access, connection and quota |
| Page opens but no AI answers | Check `APP_MODE=cloud`; `preview` is only a source-search/UI preview |
| Port 3001 is already used | Stop the other copy, or change `PORT` in `.env` and use that port in the browser |

If local reranking cannot run on your Mac, `RERANKER_PROVIDER=llm` restores the DeepSeek reranker while keeping DeepSeek answers. This adds an external model call; it is an alternative, not the local-reranker setup requested above.

**Verification limits:** automated device-selection tests cover CUDA/MPS/CPU choices. Actual model and app checks were run on the developer's Windows/NVIDIA machine; Apple MPS and the Intel dependency stack still need an on-device check. Mac latency and memory use may differ from the Windows benchmark.

For background, read the [App Overview](APP_OVERVIEW.md). For public website deployment, read the [Website Launch Guide](WEBSITE_LAUNCH_GUIDE.md).
