import math

import pytest


@pytest.fixture(autouse=True)
def _isolated_embedding_env(monkeypatch):
    # Force the deterministic hash backend for most tests below (fast, no
    # network calls). Individual tests override EMBEDDING_BACKEND as needed
    # to test the naming/selection logic for the other backends.
    monkeypatch.setenv("EMBEDDING_BACKEND", "hash")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("HUGGINGFACE_API_KEY", raising=False)


def test_embed_text_is_unit_length():
    from app.embeddings import embed_text

    vector = embed_text("Docker container platform")
    magnitude = math.sqrt(sum(v * v for v in vector))
    assert magnitude == pytest.approx(1.0, abs=1e-2)


def test_embed_text_is_deterministic():
    from app.embeddings import embed_text

    assert embed_text("Kubernetes orchestration") == embed_text("Kubernetes orchestration")


def test_embed_text_differs_for_unrelated_text():
    from app.embeddings import embed_text

    a = embed_text("Docker container platform")
    b = embed_text("Recipe for chocolate cake")
    assert a != b


def test_embed_text_handles_empty_string_without_throwing():
    from app.embeddings import embed_text

    assert embed_text("") is not None


def test_backend_name_reports_hash_when_explicitly_selected():
    from app.embeddings import embedding_backend_name

    assert embedding_backend_name() == "hashed-bag-of-words"


def test_backend_name_defaults_to_huggingface_local(monkeypatch):
    monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
    from app.embeddings import embedding_backend_name

    assert embedding_backend_name() == "huggingface-local:sentence-transformers/all-MiniLM-L6-v2"


def test_backend_name_reports_huggingface_api_when_key_present(monkeypatch):
    monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
    monkeypatch.setenv("HUGGINGFACE_API_KEY", "hf_test_token")
    from app.embeddings import embedding_backend_name

    assert embedding_backend_name() == "huggingface-api:sentence-transformers/all-MiniLM-L6-v2"


def test_backend_name_respects_custom_huggingface_model(monkeypatch):
    monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
    monkeypatch.setenv("HUGGINGFACE_MODEL", "sentence-transformers/all-mpnet-base-v2")
    from app.embeddings import embedding_backend_name

    assert embedding_backend_name() == "huggingface-local:sentence-transformers/all-mpnet-base-v2"


def test_backend_name_reports_openai_only_when_explicitly_selected(monkeypatch):
    monkeypatch.setenv("EMBEDDING_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    from app.embeddings import embedding_backend_name

    assert embedding_backend_name() == "openai:text-embedding-3-small"


def test_openai_not_used_unless_backend_explicitly_set_to_openai(monkeypatch):
    # Even with a key present, OpenAI should NOT be picked unless the backend
    # is explicitly set to "openai" -- Hugging Face is the default.
    monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    from app.embeddings import embedding_backend_name

    assert embedding_backend_name() != "openai:text-embedding-3-small"


def test_embed_texts_falls_back_gracefully_when_huggingface_unreachable(monkeypatch):
    # Simulate the default Hugging Face path with no network access: the
    # local model load will fail, and embed_texts must fall back to hash
    # embeddings rather than raising.
    monkeypatch.setenv("EMBEDDING_BACKEND", "huggingface")
    monkeypatch.delenv("HUGGINGFACE_API_KEY", raising=False)

    import app.embeddings as embeddings_module

    def _broken_model():
        raise RuntimeError("simulated: no network access to huggingface.co")

    monkeypatch.setattr(embeddings_module, "_local_hf_model", _broken_model)

    result = embeddings_module.embed_texts(["hello world"])
    assert len(result) == 1
    assert len(result[0]) == 256  # falls back to the hash embedding's dimension
