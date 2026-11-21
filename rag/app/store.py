"""Publish a complete Chroma collection per README and query its recorded encoder."""
import hashlib
import json
import os
import re
import threading
from pathlib import Path

import chromadb

from .chunking import build_readme_chunks
from .embeddings import HASH, embed_batch, embedding_backend_name, terms

_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./data/chroma")
_client = None
_lock = threading.RLock()


def _get_client():
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(
            path=_PERSIST_DIR, settings=chromadb.config.Settings(anonymized_telemetry=False)
        )
    return _client


def _manifest(source_path):
    key = hashlib.sha256(source_path.encode()).hexdigest()[:40]
    return Path(_PERSIST_DIR) / f"readme_{key}.json"


def _read_manifest(path):
    return json.loads(path.read_text()) if path.exists() else {}


def index_content(source_path: str, content: str) -> int:
    chunks = build_readme_chunks(content)
    documents = [chunk.text for chunk in chunks]
    with _lock:
        client = _get_client()
        path = _manifest(source_path)
        previous = _read_manifest(path)
        # Alternate slots so the current collection survives an interrupted rebuild.
        slot = 1 - previous.get("slot", 1)
        name = f"{path.stem}_{slot}"
        if any(c.name == name for c in client.list_collections()):
            client.delete_collection(name)
        backend = embedding_backend_name()
        if chunks:
            backend, vectors = embed_batch([f"{c.section}\n{c.text}" for c in chunks])
            collection = client.create_collection(name, metadata={"hnsw:space": "cosine"})
            batch = client.get_max_batch_size()
            for start in range(0, len(chunks), batch):
                part = chunks[start:start + batch]
                collection.add(
                    ids=[c.id for c in part], embeddings=vectors[start:start + batch],
                    documents=documents[start:start + batch],
                    metadatas=[{"section": c.section, "type": c.type} for c in part],
                )
        state = {"slot": slot, "collection": name if chunks else None, "backend": backend,
                 "revision": hashlib.sha256(content.encode()).hexdigest()}
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state))
        temporary.replace(path)
        if previous.get("collection"):
            client.delete_collection(previous["collection"])
    return len(chunks)


def _load_source(source_path):
    path = _manifest(source_path)
    if path.exists():
        return _read_manifest(path)
    # Older releases stored whole sections in a single unversioned collection.
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", source_path).strip("_") or "default"
    name = f"readme_{slug}"[:63]
    client = _get_client()
    if not any(c.name == name for c in client.list_collections()):
        return {}
    legacy = client.get_collection(name).get(where={"type": "section"}, include=["documents"])
    sections = sorted(zip(legacy["ids"], legacy["documents"]), key=lambda item: int(item[0].split("-")[-1]))
    index_content(source_path, "\n\n".join(text for _, text in sections))
    return _read_manifest(path)


def _redundant_section(candidate, entries):
    if candidate["type"] != "section":
        return False
    body = candidate["content"]
    if any(line.strip() and not re.match(r"^\s*(?:#|[-*+]\s)", line) for line in body.splitlines()):
        return False
    return any(entry["section"] == candidate["section"] and entry["content"] in body for entry in entries)


def query_version(source_path: str, query_text: str, top_k: int):
    with _lock:
        state = _load_source(source_path)
        if not state.get("collection"):
            return state.get("revision"), []
        collection = _get_client().get_collection(state["collection"])
        provider, vectors = embed_batch([query_text], state["backend"])
        tokens = set(terms(query_text))
        query_terms = tokens - {"link", "note", "reminder", "entry", "resource", "information"} or tokens
        if provider == state["backend"]:
            found = collection.query(query_embeddings=vectors, n_results=min(collection.count(), top_k * 5))
            rows = zip(found["documents"][0], found["metadatas"][0], found["distances"][0])
        else:
            # Exact token overlap rejects unrelated hash collisions and still works
            # when the encoder used to index this collection is unavailable.
            found = collection.get(include=["documents", "metadatas"])
            rows = ((doc, meta, None) for doc, meta in zip(found["documents"], found["metadatas"]))
        candidates = []
        for doc, meta, distance in rows:
            words = set(terms(meta["section"] + " " + doc))
            overlap = len(words & query_terms)
            lexical = overlap / max(1, (len(words) * len(query_terms)) ** 0.5)
            if distance is None or provider == HASH:
                if not overlap:
                    continue
                score = lexical if distance is None else (lexical + 1 - distance) / 2
            else:
                similarity = 1 - distance
                if similarity < 0.38 and not overlap:
                    continue
                score = 0.85 * similarity + 0.15 * lexical
            candidates.append(dict(section=meta["section"], title=meta["section"], content=doc,
                                   score=round(score, 6), type=meta["type"]))
        candidates.sort(key=lambda c: c["score"], reverse=True)
        entries = [c for c in candidates if c["type"] != "section"]
        results = [c for c in candidates if not _redundant_section(c, entries)]
        return state["revision"], results[:top_k]


def query(source_path: str, query_text: str, top_k: int = 4):
    return query_version(source_path, query_text, top_k)[1]


def index_status():
    with _lock:
        _get_client()
        states = [_read_manifest(p) for p in Path(_PERSIST_DIR).glob("readme_*.json")]
        active = {s["backend"] for s in states if s.get("collection")}
        return len(states), ", ".join(sorted(active)) or embedding_backend_name()
