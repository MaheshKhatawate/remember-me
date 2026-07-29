"""Standalone Python RAG microservice.

Responsible for chunking README content, embedding it, persisting vectors,
and performing semantic search — fully decoupled from the Node backend,
which calls this service over HTTP (see backend/src/utils/rag-client.ts).
"""

import logging
import traceback

from dotenv import load_dotenv

# Must run before importing store/embeddings, which read env vars (e.g.
# CHROMA_PERSIST_DIR) at import time.
load_dotenv()

from fastapi import FastAPI, HTTPException

from .embeddings import embedding_backend_name
from .schemas import HealthResponse, IndexRequest, IndexResponse, QueryRequest, QueryResponse, SearchResult
from . import store

logger = logging.getLogger("rag")
logging.basicConfig(level=logging.INFO)

# chromadb 0.5.x ships with a posthog telemetry integration that calls
# capture() with the wrong number of positional arguments in some posthog
# versions, producing noisy ERROR log lines on every operation even though
# telemetry is disabled via anonymized_telemetry=False in store.py.
# Raise the threshold for that specific logger to CRITICAL so only genuine
# internal chromadb errors (not the harmless telemetry mismatch) are printed.
logging.getLogger("chromadb.telemetry.product.posthog").setLevel(logging.CRITICAL)

app = FastAPI(
    title="Telegram README RAG Service",
    description="Chunking, embedding, and semantic search over a GitHub README.",
    version="1.0.0",
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    try:
        indexed = store.indexed_source_count()
    except Exception:
        indexed = 0

    return HealthResponse(
        status="ok",
        embedding_backend=embedding_backend_name(),
        vector_store="chromadb",
        indexed_sources=indexed,
    )


@app.post("/index", response_model=IndexResponse)
def index(payload: IndexRequest) -> IndexResponse:
    try:
        chunk_count = store.index_content(payload.source_path, payload.content)
    except Exception as error:  # noqa: BLE001
        # Full traceback goes to the server log (visible in the uvicorn
        # console) so this is always debuggable; the client gets a concise
        # message plus the exception text.
        logger.error("Indexing failed for %s:\n%s", payload.source_path, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Indexing failed: {error}") from error

    return IndexResponse(source_path=payload.source_path, chunks=chunk_count)


@app.post("/query", response_model=QueryResponse)
def query(payload: QueryRequest) -> QueryResponse:
    try:
        raw_results = store.query(payload.source_path, payload.query, payload.top_k)
    except Exception as error:  # noqa: BLE001
        logger.error("Query failed for %s:\n%s", payload.source_path, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Query failed: {error}") from error

    results = [SearchResult(**item) for item in raw_results]
    return QueryResponse(query=payload.query, results=results)
