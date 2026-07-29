import importlib

import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("CHROMA_PERSIST_DIR", str(tmp_path / "chroma"))
    monkeypatch.setenv("EMBEDDING_BACKEND", "hash")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("HUGGINGFACE_API_KEY", raising=False)

    from app import store as store_module

    importlib.reload(store_module)
    return store_module


README = """# Project

## Links

- [Docker](https://docker.com) - Container platform
- [Kubernetes](https://kubernetes.io) - Container orchestration

## Notes

Some free-form notes about machine learning pipelines.
"""


def test_index_content_returns_chunk_count(store):
    count = store.index_content("README.md", README)
    assert count > 0


def test_query_returns_relevant_results(store):
    store.index_content("README.md", README)
    results = store.query("README.md", "container orchestration", top_k=2)
    assert len(results) > 0
    assert all("score" in item for item in results)


def test_query_on_empty_index_returns_no_results(store):
    results = store.query("README.md", "anything", top_k=3)
    assert results == []


def test_reindexing_replaces_previous_chunks(store):
    initial_count = store.index_content("README.md", README)
    smaller_readme = "# Project\n\n## Links\n\n- [Docker](https://docker.com)\n"
    smaller_count = store.index_content("README.md", smaller_readme)
    assert smaller_count < initial_count

    results = store.query("README.md", "docker", top_k=10)
    assert len(results) == smaller_count
