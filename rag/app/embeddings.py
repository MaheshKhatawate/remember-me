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
import math
import os
import re
from functools import lru_cache
from typing import List

HASH_DIMENSION = 256
DEFAULT_HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> List[str]:
    return [tok for tok in _TOKEN_PATTERN.findall(text.lower()) if len(tok) > 2]


def _hash_embed(text: str) -> List[float]:
    vector = [0.0] * HASH_DIMENSION
    for token in _tokenize(text):
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
    # url = f"https://api-inference.huggingface.co/pipeline/feature-extraction/{model}"
    url = f"https://router.huggingface.co/hf-inference/models/{model}/pipeline/feature-extraction"

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        json={"inputs": texts, "options": {"wait_for_model": True}},
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


@lru_cache(maxsize=1)
def _openai_client():
    from openai import OpenAI  # type: ignore

    return OpenAI(api_key=os.environ["OPENAI_API_KEY"])


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


def embed_texts(texts: List[str]) -> List[List[float]]:
    """Embeds a batch of texts, falling back gracefully if the configured
    backend is unavailable at runtime (e.g. missing package, no network, or
    an API error) so semantic search never hard-fails."""
    if not texts:
        return []

    backend = _configured_backend()

    if backend == "openai" and os.getenv("OPENAI_API_KEY"):
        try:
            client = _openai_client()
            response = client.embeddings.create(model="text-embedding-3-small", input=texts)
            return [item.embedding for item in response.data]
        except Exception as error:  # noqa: BLE001 - deliberate broad fallback
            print(f"[embeddings] OpenAI embedding failed, falling back: {error}")

    if backend in ("huggingface", "sentence-transformers", ""):
        if os.getenv("HUGGINGFACE_API_KEY"):
            try:
                return _huggingface_inference_api_embed(texts)
            except Exception as error:  # noqa: BLE001 - deliberate broad fallback
                print(f"[embeddings] Hugging Face Inference API failed, falling back: {error}")

        try:
            model = _local_hf_model()
            return [vector.tolist() for vector in model.encode(texts)]
        except Exception as error:  # noqa: BLE001 - deliberate broad fallback
            print(f"[embeddings] Local Hugging Face model failed, falling back to hash embeddings: {error}")

    return [_hash_embed(text) for text in texts]


def embed_text(text: str) -> List[float]:
    return embed_texts([text])[0]
