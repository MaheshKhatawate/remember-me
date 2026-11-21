"""Pluggable embedding backends for the RAG service.

Hugging Face is the default and recommended embedding provider (the LLM used
elsewhere in this project — intent classification and answer synthesis in the
Node backend — is Groq; this service only handles embeddings + vector search).

Selection order, controlled by env vars:

1. HUGGINGFACE_API_KEY set
       -> Hugging Face hosted Inference API (feature-extraction pipeline),
          default model "sentence-transformers/all-MiniLM-L6-v2". No local
          model download required; good for lightweight Docker images.
2. EMBEDDING_BACKEND=huggingface (the default) and no HUGGINGFACE_API_KEY,
   but the `sentence-transformers` package is installed
       -> local Hugging Face model, run on-device.
3. EMBEDDING_BACKEND=openai and OPENAI_API_KEY set
       -> OpenAI embeddings API (text-embedding-3-small). Opt-in only; not
          used unless explicitly requested.
4. otherwise / on any failure above
       -> deterministic hashed bag-of-words vectors.

The hash fallback has no external dependencies or network calls, so the
service is fully functional out of the box even with nothing configured;
it's a coarse local baseline, not a state-of-the-art embedding.
"""

import hashlib
import logging
import math
import os
import re
from functools import lru_cache
from typing import List

HASH_DIMENSION = 256
DEFAULT_HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

_STOP_WORDS = set("a an and are as at be by can do does did find for from get have how i in is it me my of on or our please related saved search show some that the there this to was we what when where which who with you about all tell list any anything".split())


def terms(text: str) -> list[str]:
    words = re.findall(r"[^\W_]+", text.lower())
    return [word.removesuffix("s") if len(word) > 4 else word for word in words if word not in _STOP_WORDS]


def _hash_embed(text: str) -> List[float]:
    vector = [0.0] * HASH_DIMENSION
    for token in terms(text):
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        slot = int(digest, 16) % HASH_DIMENSION
        vector[slot] += 1.0

    magnitude = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [round(v / magnitude, 6) for v in vector]


def _hf_model_name() -> str:
    return os.getenv("HUGGINGFACE_MODEL", os.getenv("SENTENCE_TRANSFORMERS_MODEL", DEFAULT_HF_MODEL))


@lru_cache(maxsize=1)
def _local_hf_model():
    """Loads a local Hugging Face sentence-embedding model via sentence-transformers."""
    from sentence_transformers import SentenceTransformer  # type: ignore

    return SentenceTransformer(_hf_model_name())


def _huggingface_inference_api_embed(texts: List[str]) -> List[List[float]]:
    """Calls the Hugging Face hosted Inference API's feature-extraction pipeline."""
    import requests  # type: ignore

    api_key = os.environ["HUGGINGFACE_API_KEY"]
    model = _hf_model_name()
    url = f"https://router.huggingface.co/hf-inference/models/{model}/pipeline/feature-extraction"

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        json={"inputs": texts},
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()

    # The API returns either per-token embeddings (needing mean-pooling) or
    # already-pooled sentence embeddings depending on the model; normalize
    # both shapes down to one vector per input text.
    def pool(item):
        if isinstance(item, list) and item and isinstance(item[0], list):
            width = len(item[0])
            sums = [0.0] * width
            for token_vec in item:
                for i, value in enumerate(token_vec):
                    sums[i] += value
            return [value / len(item) for value in sums]
        return item

    return [pool(item) for item in data]


def _openai_embed(texts):
    import requests

    response = requests.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
        json={"model": "text-embedding-3-small", "input": texts}, timeout=30,
    )
    response.raise_for_status()
    return [entry["embedding"] for entry in sorted(response.json()["data"], key=lambda e: e["index"])]


def _configured_backend() -> str:
    return os.getenv("EMBEDDING_BACKEND", "huggingface").strip().lower()


def embedding_backend_name() -> str:
    backend = _configured_backend()

    if backend == "openai" and os.getenv("OPENAI_API_KEY"):
        return "openai:text-embedding-3-small"

    if backend in ("huggingface", "sentence-transformers", ""):
        if os.getenv("HUGGINGFACE_API_KEY"):
            return f"huggingface-api:{_hf_model_name()}"
        return f"huggingface-local:{_hf_model_name()}"

    return "hashed-bag-of-words"


HASH = "hashed-bag-of-words"


def embed_batch(texts: list[str], preferred: str | None = None) -> tuple[str, list[list[float]]]:
    """Return the identity of the encoder that actually produced these vectors."""
    configured = embedding_backend_name()
    requested = preferred or configured
    if requested != configured and requested != HASH:
        # A hosted index may already have fallen back to its matching local model.
        local_for_hosted = configured.replace("huggingface-api:", "huggingface-local:")
        if requested != local_for_hosted:
            requested = HASH
    providers = [requested]
    if requested.startswith("huggingface-api:"):
        providers.append(f"huggingface-local:{_hf_model_name()}")
    if HASH not in providers:
        providers.append(HASH)
    for provider in providers:
        if provider == HASH:
            return HASH, [_hash_embed(text) for text in texts]
        try:
            if provider.startswith("openai:"):
                if _configured_backend() != "openai":
                    continue
                vectors = _openai_embed(texts)
            elif provider.split(":", 1)[1] != _hf_model_name():
                continue
            elif provider.startswith("huggingface-api:"):
                vectors = _huggingface_inference_api_embed(texts)
            else:
                vectors = _local_hf_model().encode(texts, normalize_embeddings=True, show_progress_bar=False).tolist()
            if len(vectors) != len(texts) or not all(v and len(v) == len(vectors[0]) and all(math.isfinite(x) for x in v) for v in vectors):
                raise ValueError("Incomplete embedding response")
            return provider, vectors
        except Exception as error:
            logging.warning("Embedding provider %s unavailable (%s)", provider, type(error).__name__)
    raise RuntimeError("No embedding provider available")


def embed_texts(texts: List[str]) -> List[List[float]]:
    return embed_batch(texts)[1] if texts else []


def embed_text(text: str) -> List[float]:
    return embed_texts([text])[0]
