# Telegram-Driven GitHub README Manager + RAG

A Telegram bot that manages a GitHub repository's `README.md` (Create / Read / Update / Delete)
and answers natural-language questions about its contents using Retrieval-Augmented Generation.

```
Telegram  ──▶  backend (Node/TypeScript)  ──▶  GitHub Contents API (README.md)
                     │        ▲
                     │        │  HTTP (index / query)
                     ▼        │
              MongoDB    rag (Python/FastAPI + ChromaDB)
            (audit log,
           local fallback
              index)
```

## Services

| Service   | Stack                          | Responsibility                                                                 |
|-----------|---------------------------------|---------------------------------------------------------------------------------|
| `backend` | Node 22, TypeScript, Express, Telegraf, LangChain+**Groq** | Telegram bot, HTTP API, intent classification (Groq LLM), GitHub CRUD, orchestration |
| `rag`     | Python 3.11, FastAPI, ChromaDB, **Hugging Face** embeddings | Markdown chunking, embeddings, vector storage, semantic search |
| `mongo`   | MongoDB 7                       | Audit trail of every processed message + local fallback vector index           |

**LLM:** Groq (`llama-3.3-70b-versatile` via `@langchain/groq`) powers both the Telegram message
intent classifier and RAG answer synthesis in `backend/`. Set `GROQ_API_KEY` to enable it; without
it, the backend falls back to a regex/keyword classifier and returns raw retrieved snippets
instead of an LLM-composed answer.

**Embeddings:** Hugging Face is the default and recommended embedding provider for the `rag`
service — either the hosted Inference API (`HUGGINGFACE_API_KEY` set, no local model download) or
a local `sentence-transformers` model (`sentence-transformers/all-MiniLM-L6-v2` by default, run
on-device). OpenAI embeddings remain available as an explicit opt-in (`EMBEDDING_BACKEND=openai`),
and a dependency-free hashed bag-of-words fallback keeps search working even with nothing
configured.

The `backend` calls `rag` over HTTP for indexing/search. If `RAG_SERVICE_URL` is unset or the
service is unreachable, `backend` automatically falls back to an in-process hash-embedding index
stored in MongoDB, so the system degrades gracefully rather than failing outright.

## Quick start

See **[RUN_GUIDE.md](./RUN_GUIDE.md)** for full setup instructions (Docker Compose or manual CLI),
and **[PROGRESS_AND_TESTS.md](./PROGRESS_AND_TESTS.md)** for the feature checklist and manual test
scripts with example Telegram commands and expected outputs.

## Repository layout

```
.
├── backend/                 # Telegram bot + HTTP API + GitHub integration
│   ├── src/
│   │   ├── apis/            # Express route handlers (reader, status, sync)
│   │   ├── middleware/       # Shared-secret API auth
│   │   ├── models/           # Mongoose schemas
│   │   ├── services/         # bot.ts (Telegraf), assistant.ts (orchestrator), rag.ts
│   │   ├── types/            # Zod schemas / shared types
│   │   └── utils/            # GitHub client, README markdown engine, classifier, RAG client
│   ├── Dockerfile
│   └── .env.example
├── rag/                      # Standalone Python RAG microservice
│   ├── app/
│   │   ├── main.py           # FastAPI app (/health, /index, /query)
│   │   ├── chunking.py       # Markdown → chunks
│   │   ├── embeddings.py     # OpenAI / sentence-transformers / hash fallback
│   │   └── store.py          # ChromaDB persistence + similarity search
│   ├── Dockerfile
│   └── .env.example
├── docker-compose.yml        # mongo + backend + rag, wired together
├── RUN_GUIDE.md
└── PROGRESS_AND_TESTS.md
```
