# remember-me

> **A README that you talk to.** Manage a GitHub repository's `README.md` entirely through
> Telegram — add links, search your notes semantically, update or delete entries, and keep
> everything committed to Git — without opening a browser or touching a file directly.

```
Telegram  ──▶  backend (Node.js / TypeScript)  ──▶  GitHub Contents API
                     │                    ▲                (README.md)
                     │  HTTP              │ HTTP
                     │  /index /query     │ /health
                     ▼                    │
              RAG microservice (Python / FastAPI / ChromaDB)

              MongoDB
              ├── audit log (every processed message)
              └── local fallback vector index (hash embeddings)
```

---

## Table of Contents

- [How it works](#how-it-works)
- [Services](#services)
- [Quick start](#quick-start)
  - [Option A — Docker Compose](#option-a--docker-compose-recommended)
  - [Option B — Manual CLI](#option-b--manual-cli)
- [Environment variables](#environment-variables)
- [Telegram commands](#telegram-commands)
- [HTTP API reference](#http-api-reference)
- [Repository layout](#repository-layout)
- [Architecture details](#architecture-details)
- [Testing](#testing)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)

---

## How it works

Every message you send to the Telegram bot goes through this pipeline:

1. **Classify** — A heuristic regex/keyword classifier (always on) determines whether the
   message is a CREATE / READ / UPDATE / DELETE operation. If `GROQ_API_KEY` is configured,
   Groq's `llama-3.3-70b-versatile` model confirms or overrides the heuristic result via
   structured output.
2. **Act**
   - **CREATE / UPDATE / DELETE** — The backend reads the current `README.md` from GitHub,
     applies the text mutation (append, replace-in-place, or remove a bullet line), and commits
     the new content back to GitHub if anything actually changed. The RAG index is rebuilt after
     every successful write.
   - **READ** — The query is embedded and run against the RAG service (or the local MongoDB
     fallback). The top-k matching chunks are passed to Groq to compose a natural-language answer
     (or returned as raw ranked snippets if no Groq key is set).
3. **Reply** — The result or answer is sent back to you in Telegram.

The system **never fails hard** — every external dependency has a graceful fallback:

| Component | Primary | Fallback |
|---|---|---|
| Intent classification | Groq LLM (`llama-3.3-70b-versatile`) | Regex/keyword heuristic |
| Embeddings | Hugging Face (API or local model) | Hashed bag-of-words |
| Vector search | Python RAG service (ChromaDB) | In-process cosine similarity over MongoDB |

---

## Services

| Service | Stack | Responsibility |
|---|---|---|
| `backend` | Node.js 22, TypeScript (strict), Express 5, Telegraf 4, LangChain + Groq, Mongoose, Zod | Telegram long-polling bot, HTTP API, intent classification, GitHub CRUD, RAG orchestration |
| `rag` | Python 3.11, FastAPI, Uvicorn, ChromaDB, sentence-transformers / HF Inference API | Markdown chunking, embedding, vector persistence, semantic search |
| `mongo` | MongoDB 7 | Audit trail of every processed message; local fallback vector index |

---

## Quick start

### Prerequisites

- **Telegram bot token** — message [@BotFather](https://t.me/BotFather), run `/newbot`, copy the token.
- **GitHub personal access token** — create at <https://github.com/settings/tokens> with
  `Contents: Read and write` on the target repository (fine-grained) or `repo` scope (classic).
- **Groq API key** *(recommended)* — <https://console.groq.com/keys>. Powers intent
  classification and RAG answer synthesis. Without it, the system falls back to a keyword
  classifier and returns raw matching snippets.
- **Hugging Face token** *(optional)* — <https://huggingface.co/settings/tokens>. Lets the RAG
  service use the hosted Inference API instead of downloading a local model. If omitted,
  `sentence-transformers/all-MiniLM-L6-v2` (~90 MB) is downloaded on first use.
- **Docker + Docker Compose** for Option A, or **Node.js 22+** and **Python 3.11+** for Option B.

---

### Option A — Docker Compose (recommended)

```bash
# 1. Clone and copy example env files
git clone <your-fork-url> remember-me && cd remember-me
cp backend/.env.example backend/.env
cp rag/.env.example rag/.env

# 2. Fill in backend/.env (minimum required keys):
#    TELEGRAM_BOT_TOKEN=...
#    GITHUB_OWNER=your-username-or-org
#    GITHUB_REPO=your-repo-name
#    GITHUB_TOKEN=...
#    GROQ_API_KEY=...                       # optional but recommended
#    BACKEND_API_SECRET=...                 # optional, secures the HTTP API
#    TELEGRAM_ALLOWED_USER_IDS=123456789    # optional, restricts bot access

# 3. (Optional) Set HUGGINGFACE_API_KEY in rag/.env to use the hosted API
#    instead of a local model download.

# 4. Start everything
docker compose up --build
```

Watch the logs for:

```
readme-assistant-backend  | Connected to MongoDB
readme-assistant-backend  | Server running on http://localhost:3000
readme-assistant-backend  | Telegram bot is running
```

Open Telegram, find your bot, and send `/help` to confirm it's alive.
Send `/sync` to index an existing README.

To stop: `docker compose down` (add `-v` to also wipe MongoDB and ChromaDB volumes).

> **Access control:** By default, **any Telegram user who finds your bot has full read/write
> access to the repository**. Set `TELEGRAM_ALLOWED_USER_IDS` to a comma-separated list of
> numeric Telegram user IDs before sharing the bot.
> Message [@userinfobot](https://t.me/userinfobot) to find your own ID.

---

### Option B — Manual CLI

#### MongoDB

Run a local instance or use a hosted URI (MongoDB Atlas free tier works):

```bash
mongod --dbpath ./data/db
```

#### RAG service

```bash
cd rag
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # edit if needed
uvicorn app.main:app --host 0.0.0.0 --port 8001
# Verify: curl http://localhost:8001/health
```

#### Backend + bot

```bash
cd backend
cp .env.example .env   # fill in TELEGRAM_BOT_TOKEN, GITHUB_*, MONGODB_URI, etc.
npm install
npm run build
node dist/index.js
# Verify: curl http://localhost:3000/health  →  {"message":"healthy"}
```

For auto-reload during development: `npm run dev` (uses `nodemon`, already a dependency).

---

## Environment variables

### `backend/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Token from @BotFather |
| `MONGODB_URI` | ✅ | — | MongoDB connection string |
| `GITHUB_OWNER` | ✅ | — | GitHub username or org that owns the repo |
| `GITHUB_REPO` | ✅ | — | Repository name |
| `GITHUB_TOKEN` | ✅ | — | GitHub PAT with `Contents: read+write` |
| `GITHUB_BRANCH` | — | `main` | Branch to read/write `README.md` on |
| `GROQ_API_KEY` | — | — | Enables LLM classification and answer synthesis |
| `PORT` | — | `3000` | HTTP server port |
| `BACKEND_URL` | — | `http://127.0.0.1:3000` | Self-URL; the bot uses this to call its own API |
| `BACKEND_API_SECRET` | — | — | When set, all `/api/*` routes require `x-api-key: <value>` |
| `TELEGRAM_ALLOWED_USER_IDS` | — | *(allow all)* | Comma-separated Telegram user IDs allowed to use the bot |
| `RAG_SERVICE_URL` | — | — | URL of the Python RAG service (e.g. `http://localhost:8001`). Unset = local MongoDB fallback |
| `RAG_SERVICE_TIMEOUT_MS` | — | `8000` | Timeout (ms) for calls to the RAG service |

### `rag/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `RAG_PORT` | — | `8001` | Uvicorn port |
| `CHROMA_PERSIST_DIR` | — | `./data/chroma` | Directory for ChromaDB persistence |
| `EMBEDDING_BACKEND` | — | `huggingface` | `huggingface` (default) or `openai` |
| `HUGGINGFACE_MODEL` | — | `sentence-transformers/all-MiniLM-L6-v2` | Model name for local or API-based HF embeddings |
| `HUGGINGFACE_API_KEY` | — | — | When set, uses the Hugging Face hosted Inference API (no local model download) |
| `OPENAI_API_KEY` | — | — | Required when `EMBEDDING_BACKEND=openai` |

---

## Telegram commands

| Command | Description |
|---|---|
| `/help` | Show the command reference |
| `/start` | Same as `/help` |
| `/status` | Live health check — MongoDB, GitHub config, RAG service, Groq |
| `/sync` | Re-fetch `README.md` from GitHub and rebuild the search index |
| `/reset` | Shows a safety warning; does nothing yet |
| `/reset CONFIRM` | Wipes the entire `README.md` to empty and clears the search index |
| `/reset CONFIRM <content>` | Replaces the entire `README.md` with `<content>` and rebuilds the index |
| `/add <topic> [url] [description]` | Append a new entry to the README |
| `/create …` | Alias for `/add` |
| `/new …` | Alias for `/add` |
| `/update <topic> [url] [description]` | Update a matching entry in place |
| `/edit …` | Alias for `/update` |
| `/delete <topic>` | Remove a matching entry |
| `/remove …` | Alias for `/delete` |
| `/get <topic>` | Semantic search for an entry |
| `/find …` | Alias for `/get` |
| `/search …` | Alias for `/get` |
| *plain text* | Any message without a `/` prefix is treated as a semantic READ query |

**Entry format produced by `/add`:**

```
- [Title](https://url.com) - description
```

If no URL is provided: `- Title - description` or simply `- description`.
Entries are appended to a named section (default: `## Links`). The section is created
automatically if it doesn't already exist.

---

## HTTP API reference

All `/api/*` endpoints require the `x-api-key` header when `BACKEND_API_SECRET` is set.

### `GET /health`

Liveness probe. Returns `{ "message": "healthy" }` with HTTP 200.

### `POST /api/reader`

Main message-processing endpoint. The Telegram bot calls this for every user message.

**Request body:**
```json
{ "message": "find me docker links" }
```

**Response (READ, no Groq key):**
```json
{
  "message": "Best local matches for: find me docker links\n1. [Links] Docker: ...",
  "result": {
    "intent": "READ",
    "classification": { "intent": "READ", "type": "normal", "confidence": 0.7 },
    "searchResults": [{ "section": "Links", "content": "...", "score": 0.91 }]
  }
}
```

**Response (CREATE):**
```json
{
  "message": "README updated: Inserted entry into Links",
  "result": {
    "intent": "CREATE",
    "classification": { ... },
    "repoWrite": { "path": "README.md", "branch": "main", "commitMessage": "CREATE README entry from Telegram" }
  }
}
```

### `GET /api/status`

Returns aggregated health of all dependencies.

```json
{
  "message": "ok",
  "uptimeSeconds": 42,
  "mongo": { "state": "connected", "connected": true },
  "github": { "configured": true, "owner": "you", "repo": "my-notes", "branch": "main" },
  "ragService": { "configured": true, "reachable": true },
  "groqConfigured": true
}
```

### `POST /api/sync`

Re-fetches `README.md` from GitHub and rebuilds the search index.

```json
{ "message": "Synced README (14 chunks) using the remote RAG service.", "chunks": 14, "remote": true }
```

### `POST /api/reset`

Wipes or replaces `README.md` and resets the search index.
The Telegram `/reset CONFIRM` command calls this internally.

**Request body:**
```json
{ "content": "# My Notes\n\n## Links\n" }
```

Omit `content` (or send empty string) to wipe the file completely.

---

## Repository layout

```
.
├── backend/                         # Telegram bot + HTTP API + GitHub integration
│   ├── src/
│   │   ├── apis/
│   │   │   ├── reader.ts            # POST /api/reader
│   │   │   ├── reset.ts             # POST /api/reset
│   │   │   ├── status.ts            # GET  /api/status
│   │   │   └── sync.ts              # POST /api/sync
│   │   ├── middleware/
│   │   │   └── auth.ts              # x-api-key shared-secret middleware
│   │   ├── models/
│   │   │   └── resource.ts          # Mongoose schema (audit log + local vector index)
│   │   ├── services/
│   │   │   ├── assistant.ts         # Orchestrator: classify → mutate/search → respond
│   │   │   ├── bot.ts               # Telegraf bot, command handlers, access control
│   │   │   └── rag.ts               # syncReadmeIndex / searchReadme / answerWithContext
│   │   ├── types/
│   │   │   ├── assistant.ts         # Zod schemas + TypeScript types for the assistant
│   │   │   └── message.ts           # Zod schema for /api/reader request body
│   │   ├── utils/
│   │   │   ├── category.ts          # Heuristic + Groq intent classifier
│   │   │   ├── github-repo.ts       # GitHub Contents API — read file
│   │   │   ├── rag-client.ts        # HTTP client for the Python RAG service
│   │   │   ├── readme-markdown.ts   # Markdown CRUD engine + chunk builder
│   │   │   └── write-repo.ts        # GitHub Contents API — write file (SHA handling)
│   │   └── index.ts                 # Express app bootstrap + graceful shutdown
│   ├── src/__tests__/               # Vitest unit tests (37 tests)
│   ├── Dockerfile
│   ├── tsconfig.json
│   ├── package.json
│   └── .env.example
│
├── rag/                             # Standalone Python RAG microservice
│   ├── app/
│   │   ├── chunking.py              # Markdown → section + bullet-level chunks
│   │   ├── embeddings.py            # Hugging Face / OpenAI / hash-fallback backends
│   │   ├── main.py                  # FastAPI app: GET /health, POST /index, POST /query
│   │   ├── schemas.py               # Pydantic request/response models
│   │   └── store.py                 # ChromaDB persistence + similarity search
│   ├── tests/                       # pytest tests (23 tests)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── pytest.ini
│   └── .env.example
│
├── docker-compose.yml               # mongo + rag + backend, health-checked
├── README.md                        # this file
├── RUN_GUIDE.md                     # detailed setup and troubleshooting guide
└── PROGRESS_AND_TESTS.md            # feature checklist + manual test walkthrough
```

---

## Architecture details

### Intent classification (`category.ts`)

Every incoming message goes through a two-layer classifier:

1. **Heuristic** — regex/keyword patterns map command prefixes and natural-language trigger words
   to CREATE / READ / UPDATE / DELETE intents. Extracts URLs and splits title from description
   for `/add`-style commands (e.g. `/add Docker https://docker.com Container platform` →
   `title="Docker"`, `url=...`, `content="Container platform"`). Always runs; zero dependencies.
2. **Groq LLM** *(when `GROQ_API_KEY` is set)* — `llama-3.3-70b-versatile` via `@langchain/groq`
   with `withStructuredOutput` validated by a Zod schema. The LLM result is merged with the
   heuristic baseline, with LLM taking priority for the `intent` field while heuristic URL
   extraction is kept as a reliable fallback.

### README CRUD engine (`readme-markdown.ts`)

Operates on raw Markdown text (string-in → string-out, fully unit-tested):

- **`appendReadmeEntry`** — finds or creates a `## Section` heading, appends a bullet line at
  the end of that section, collapses runs of 3+ blank lines.
- **`replaceReadmeEntry`** — finds the first bullet line whose normalized text contains any of the
  provided tokens, replaces it in place. Reports `changed: false` if nothing matches.
- **`removeReadmeEntry`** — finds and splices out a matching bullet line, trims trailing blank
  lines. No commit is made if nothing matches.
- **`buildReadmeChunks`** — splits content into section-level and bullet/link-level chunks for
  embedding; mirrored identically in Python (`chunking.py`).

### GitHub integration (`write-repo.ts`)

Uses the GitHub REST [Contents API](https://docs.github.com/en/rest/repos/contents):

- **Read** — `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}`, decodes base64 content.
- **Write** — fetches the current file SHA first (required for updates), then `PUT`s with the
  new base64 content and a descriptive commit message. Creates the file if it doesn't exist.
  No write happens unless content genuinely changed (no empty commits).

### RAG pipeline

The RAG index is kept in sync automatically — rebuilt after every CREATE / UPDATE / DELETE /
RESET and on every `/sync` command.

**Python service (`rag/`):**

- `POST /index` — chunks content with `build_readme_chunks()`, embeds all chunks, wipes and
  repopulates the ChromaDB collection for that `source_path` (no stale chunks left over).
- `POST /query` — embeds the query, runs `collection.query()`, converts Chroma's L2 distances
  to bounded, higher-is-better similarity scores, returns top-k results.
- `GET /health` — returns active embedding backend name, vector store type, and indexed source count.

**Node fallback (`rag.ts`):**

When `RAG_SERVICE_URL` is unset or the service is unreachable, the backend transparently falls
back to an in-process implementation:

- Chunks the README the same way (mirrored TypeScript `buildReadmeChunks`).
- Embeds chunks with a 96-dimension deterministic hashed bag-of-words function (no network calls).
- Stores embeddings in MongoDB (`kind: "readme_chunk"`), keyed by `sourcePath`.
- Runs cosine similarity at query time.

### Embedding backends (in selection order)

| Priority | Condition | Backend |
|---|---|---|
| 1 | `HUGGINGFACE_API_KEY` set | Hugging Face hosted Inference API (no local model download) |
| 2 | `EMBEDDING_BACKEND=huggingface` (default), no API key | Local `sentence-transformers` model |
| 3 | `EMBEDDING_BACKEND=openai` + `OPENAI_API_KEY` set | OpenAI `text-embedding-3-small` |
| 4 | Any failure in backends 1–3 | Deterministic hashed bag-of-words (no dependencies) |

Any failure in a higher-priority backend is caught, logged, and the next backend is tried
automatically — semantic search never hard-fails.

---

## Testing

### Backend — Vitest (37 tests)

```bash
cd backend
npm install
npm test
```

Covers:
- README CRUD engine (`appendReadmeEntry`, `replaceReadmeEntry`, `removeReadmeEntry`,
  `buildReadmeChunks`, `compactReadmeText`)
- Heuristic intent classifier (`categorise`)
- Hash-embedding fallback (`embedText`)
- `isRagServiceConfigured` detection
- `POST /api/reset` endpoint (mocked GitHub write + RAG sync calls)
- `parseResetCommand` — CONFIRM parsing and replacement-content extraction

### RAG service — pytest (23 tests)

```bash
cd rag
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
```

Covers:
- Markdown chunking (`build_readme_chunks`)
- Embedding backend selection and fallback chain (HF API, local model, OpenAI, hash fallback)
- ChromaDB store: `index_content`, `query`, re-index (wipe + repopulate)
- FastAPI endpoints end-to-end via `TestClient` (`/health`, `/index`, `/query`)

Both suites are **fully self-contained** — no live Telegram bot, GitHub repo, Groq API, or
running database is required.

---

## Limitations

- **No end-to-end integration tests** against live credentials — the GitHub, Telegram, and Groq
  client wrappers are thin and not separately mocked/tested at the integration level.
- **Single-line matching** — `replaceReadmeEntry` / `removeReadmeEntry` match tokens against a
  single bullet line. Multi-line entries or subsections are not cleanly handled.
- **No rate limiting** — access is controlled by `TELEGRAM_ALLOWED_USER_IDS` (default: any
  Telegram user with the bot link has full CRUD access). Configure this before sharing the bot.
- **Hash-embedding fallback is coarse** — only used when the Hugging Face model can't load.
  Check `/status` to confirm which embedding backend is active.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Bot doesn't respond at all | Wrong `TELEGRAM_BOT_TOKEN`, or another process is already long-polling with the same token |
| `/status` shows GitHub not configured | Missing `GITHUB_OWNER`, `GITHUB_REPO`, or `GITHUB_TOKEN` in `backend/.env` |
| README writes fail with 404 | `GITHUB_BRANCH` doesn't exist, or the token lacks write access to the repository |
| RAG answers are generic / low quality | No `GROQ_API_KEY` set — returning raw retrieved snippets instead of an LLM-composed answer |
| Search results seem irrelevant | `/status` shows the hash fallback instead of a `huggingface-*` backend — HF model failed to load (no internet on first run, or `sentence-transformers` not installed) |
| First `/sync` or query is very slow | Expected — the local HF model downloads once (~90 MB) on first use and is cached afterward |
| `docker compose up` fails on `rag` healthcheck | First build installs heavy packages; increase `retries` in `docker-compose.yml` if your machine or network is slow |
| Message to bot returns "You're not authorized" | Your Telegram user ID is not in `TELEGRAM_ALLOWED_USER_IDS`; message @userinfobot to find your ID |
