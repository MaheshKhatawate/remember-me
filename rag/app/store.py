"""Persistent vector storage for README chunks, backed by ChromaDB.

Each "source_path" (e.g. README.md) gets its own logical collection so
multiple repos/files could be indexed side by side without colliding.
"""

import os
import re
from typing import Dict, List, Optional

import chromadb

from .embeddings import embed_texts
from .chunking import ReadmeChunk, build_readme_chunks

_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./data/chroma")
_client: Optional[chromadb.ClientAPI] = None


def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        try:
            os.makedirs(_PERSIST_DIR, exist_ok=True)
            # Anonymized telemetry is disabled: recent chromadb/posthog
            # version combinations throw a harmless-but-noisy
            # "capture() takes 1 positional argument but 3 were given"
            # error on every call otherwise.
            _client = chromadb.PersistentClient(
                path=_PERSIST_DIR,
                settings=chromadb.config.Settings(anonymized_telemetry=False),
            )
        except OSError as error:
            raise RuntimeError(
                f"Could not create/open Chroma persist directory '{_PERSIST_DIR}'. "
                f"Set CHROMA_PERSIST_DIR in rag/.env to a writable path. Original error: {error}"
            ) from error
    return _client


def _collection_name(source_path: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", source_path).strip("_") or "default"
    return f"readme_{slug}"[:63]


def _get_collection(source_path: str):
    client = _get_client()
    return client.get_or_create_collection(name=_collection_name(source_path))


def index_content(source_path: str, content: str) -> int:
    """Chunks + embeds `content` and (re)persists it, replacing any
    previously indexed chunks for this source_path. Returns chunk count."""
    collection = _get_collection(source_path)

    # Clear existing vectors for this source before re-indexing.
    existing = collection.get()
    if existing and existing.get("ids"):
        collection.delete(ids=existing["ids"])

    chunks: List[ReadmeChunk] = build_readme_chunks(content)
    if not chunks:
        return 0

    texts = [chunk.text for chunk in chunks]
    embeddings = embed_texts(texts)

    collection.add(
        ids=[chunk.id for chunk in chunks],
        embeddings=embeddings,
        documents=texts,
        metadatas=[{"section": chunk.section, "title": chunk.heading, "type": chunk.type} for chunk in chunks],
    )

    return len(chunks)


def query(source_path: str, query_text: str, top_k: int = 4) -> List[Dict]:
    collection = _get_collection(source_path)
    if collection.count() == 0:
        return []

    query_embedding = embed_texts([query_text])[0]
    result = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(top_k, max(collection.count(), 1)),
    )

    documents = (result.get("documents") or [[]])[0]
    metadatas = (result.get("metadatas") or [[]])[0]
    distances = (result.get("distances") or [[]])[0]

    output: List[Dict] = []
    for document, metadata, distance in zip(documents, metadatas, distances):
        # Chroma returns squared-L2 distance by default for normalized vectors;
        # convert to a bounded, higher-is-better similarity score for the caller.
        score = 1.0 / (1.0 + max(distance, 0.0))
        output.append(
            {
                "section": (metadata or {}).get("section"),
                "title": (metadata or {}).get("title"),
                "content": document,
                "score": round(score, 6),
            }
        )

    return output


def indexed_source_count() -> int:
    return len(_get_client().list_collections())
