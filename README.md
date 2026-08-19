# Remember Me — Telegram-Driven GitHub README Manager

> A personal knowledge base that lives inside a GitHub `README.md`, managed entirely through Telegram chat. Message a bot in plain English to save links, search notes semantically, and keep everything committed to Git — no web dashboard needed.

```
Telegram  ──▶  Backend (Node.js / TypeScript)  ──▶  GitHub Contents API
                     │                                    (README.md)
                     │  HTTP /index /query
                     ▼
              RAG Service (Python / FastAPI / ChromaDB)

              MongoDB
              ├── audit log (every processed message)
              └── local fallback vector index
```

---

## Features

- **Chat-native CRUD** — `/add`, `/update`, `/delete`, `/get` entries via Telegram slash commands or plain English
- **Semantic search (RAG)** — ask "find me links about containers" and get relevant results, not keyword matches
- **Git-backed** — every change is committed to GitHub with a descriptive message; full history via `git log`
- **LLM-powered classification** — Groq (`llama-3.3-70b-versatile`) classifies intent and synthesizes answers
- **Graceful degradation** — every external dependency has a fallback; the system never hard-fails:

| Component | Primary | Fallback |
|---|---|---|
| Intent classification | Groq LLM | Regex/keyword heuristic |
| Embeddings | Hugging Face (API or local model) | Hashed bag-of-words |
| Vector search | Python RAG service (ChromaDB) | In-process cosine similarity over MongoDB |

---

## Tech Stack

| Service | Stack | Role |
|---|---|---|
| **Backend** | Node.js 22, TypeScript (strict), Express 5, Telegraf 4, LangChain + Groq, Mongoose, Zod | Telegram bot, HTTP API, intent classification, GitHub CRUD, RAG orchestration |
| **RAG** | Python 3.11, FastAPI, ChromaDB, sentence-transformers | Markdown chunking, embedding, vector search |
| **MongoDB** | MongoDB 7 | Audit log, local fallback vector index |

---

## Quick Start

### Prerequisites

- **Telegram bot token** — message [@BotFather](https://t.me/BotFather), run `/newbot`, copy the token
- **GitHub PAT** — [create one](https://github.com/settings/tokens) with `Contents: Read and write` on the target repo
- **Groq API key** *(recommended)* — [console.groq.com/keys](https://console.groq.com/keys)
- **Docker + Docker Compose**

### Docker Compose (recommended)

```bash
cp backend/.env.example backend/.env
cp rag/.env.example rag/.env
```

Fill in `backend/.env`:

```env
TELEGRAM_BOT_TOKEN=<your-bot-token>
GITHUB_OWNER=<your-github-username>
GITHUB_REPO=<your-repo-name>
GITHUB_TOKEN=<your-github-pat>
GROQ_API_KEY=<your-groq-key>          # optional but recommended
```

Then start everything:

```bash
docker compose up --build
```

Watch for:

```
readme-assistant-backend  | Connected to MongoDB
readme-assistant-backend  | Server running on http://localhost:3000
readme-assistant-backend  | Telegram bot is running
```

Open Telegram → find your bot → send `/help`. Send `/sync` to index an existing README.

To stop: `docker compose down` (add `-v` to also wipe volumes).

> **Security note:** By default, any Telegram user who finds your bot has full read/write access. Set `TELEGRAM_ALLOWED_USER_IDS` to a comma-separated list of Telegram user IDs to restrict access. Message [@userinfobot](https://t.me/userinfobot) to find your ID.

### Manual Setup (no Docker)

**MongoDB** — Run locally (`mongod --dbpath ./data/db`) or use [MongoDB Atlas](https://www.mongodb.com/atlas) free tier.

**RAG service:**

```bash
cd rag
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

**Backend:**

```bash
cd backend
cp .env.example .env   # fill in TELEGRAM_BOT_TOKEN, GITHUB_*, GROQ_API_KEY, MONGODB_URI
npm install
npm run build
node dist/index.js     # or: npm run dev (auto-reload)
```

---

## Environment Variables

### `backend/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Token from @BotFather |
| `MONGODB_URI` | ✅ | — | MongoDB connection string |
| `GITHUB_OWNER` | ✅ | — | GitHub username or org |
| `GITHUB_REPO` | ✅ | — | Repository name |
| `GITHUB_TOKEN` | ✅ | — | GitHub PAT with Contents read+write |
| `GITHUB_BRANCH` | — | `main` | Branch to read/write README on |
| `GROQ_API_KEY` | — | — | Enables LLM classification + answer synthesis |
| `BACKEND_API_SECRET` | — | — | Shared secret for `/api/*` routes (`x-api-key` header) |
| `TELEGRAM_ALLOWED_USER_IDS` | — | *(all)* | Comma-separated Telegram user IDs |
| `RAG_SERVICE_URL` | — | — | Python RAG service URL (unset = local fallback) |

### `rag/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `EMBEDDING_BACKEND` | — | `huggingface` | `huggingface` or `openai` |
| `HUGGINGFACE_API_KEY` | — | — | Use HF hosted API (no local model download) |
| `HUGGINGFACE_MODEL` | — | `sentence-transformers/all-MiniLM-L6-v2` | Embedding model |
| `CHROMA_PERSIST_DIR` | — | `./data/chroma` | ChromaDB persistence directory |

---

## Telegram Commands

| Command | Description |
|---|---|
| `/help` | Show command reference |
| `/status` | Health check — MongoDB, GitHub, RAG service, Groq |
| `/sync` | Re-fetch README from GitHub and rebuild search index |
| `/add <topic> [url] [description]` | Append a new entry |
| `/update <topic> [url] [description]` | Update a matching entry in place |
| `/delete <topic>` | Remove a matching entry |
| `/get <topic>` | Semantic search |
| `/reset CONFIRM` | Wipe the entire README (requires CONFIRM) |
| *plain text* | Treated as a semantic search query |

Aliases: `/create`, `/new` → add · `/edit` → update · `/remove` → delete · `/find`, `/search` → get

---

## Testing

### Backend — 37 tests (Vitest)

```bash
cd backend && npm install && npm test
```

Covers: README CRUD engine, heuristic intent classifier, hash-embedding fallback, RAG-service detection, `/api/reset` endpoint, `/reset` command parsing.

### RAG Service — 23 tests (pytest)

```bash
cd rag
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
```

Covers: Markdown chunking, embedding backend selection/fallback, ChromaDB store operations, FastAPI endpoints end-to-end.

Both suites are **fully self-contained** — no live credentials, database, or network access required.

---

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── apis/           # Express routes (reader, status, sync, reset)
│   │   ├── middleware/      # x-api-key auth
│   │   ├── models/          # Mongoose schema (audit log + vector index)
│   │   ├── services/        # Bot, assistant orchestrator, RAG integration
│   │   ├── types/           # Zod schemas + TypeScript types
│   │   ├── utils/           # Classifier, GitHub API, CRUD engine, RAG client
│   │   └── index.ts         # Express app + graceful shutdown
│   ├── src/__tests__/       # Vitest unit tests
│   ├── Dockerfile
│   └── .env.example
│
├── rag/
│   ├── app/
│   │   ├── main.py          # FastAPI: /health, /index, /query
│   │   ├── chunking.py      # Markdown → chunks
│   │   ├── embeddings.py    # HF / OpenAI / hash fallback
│   │   ├── store.py         # ChromaDB persistence
│   │   └── schemas.py       # Pydantic models
│   ├── tests/               # pytest tests
│   ├── Dockerfile
│   └── .env.example
│
└── docker-compose.yml       # mongo + rag + backend
```

---

## Troubleshooting

| Symptom | Likely Cause |
|---|---|
| Bot doesn't respond | Wrong `TELEGRAM_BOT_TOKEN`, or another instance is polling with the same token |
| `/status` shows GitHub not configured | Missing `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_TOKEN` |
| README writes fail with 404 | `GITHUB_BRANCH` doesn't exist, or token lacks write access |
| RAG answers are generic | No `GROQ_API_KEY` — returning raw snippets instead of LLM answer |
| Search results seem irrelevant | Hash fallback active instead of HF model — check `/status` |
| First `/sync` is slow | Normal — local HF model downloads once (~90 MB) |
| `docker compose up` fails on `rag` healthcheck | Heavy packages installing — increase `retries` in `docker-compose.yml` |
