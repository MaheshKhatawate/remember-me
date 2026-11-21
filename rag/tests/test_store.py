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
    assert [r["content"] for r in results] == ["[Docker](https://docker.com)"]
    assert store.query("README.md", "orchestration") == []


def test_failed_rebuild_preserves_the_previous_snapshot(store, monkeypatch):
    store.index_content("README.md", README)

    def broken(*args):
        raise RuntimeError("interrupted rebuild")

    with monkeypatch.context() as patch:
        patch.setattr(store, "embed_batch", broken)
        with pytest.raises(RuntimeError):
            store.index_content("README.md", "- New entry")

    assert "Kubernetes" in store.query("README.md", "orchestration")[0]["content"]


def test_query_survives_encoder_change_and_reindex_with_new_dimension(store, monkeypatch):
    def semantic(texts, preferred=None):
        return "test-encoder", [[1., 0., 0.] for _ in texts]

    with monkeypatch.context() as patch:
        patch.setattr(store, "embed_batch", semantic)
        store.index_content("README.md", README)

    # Simulate a failed provider returning a different encoder on query.
    embed = store.embed_batch
    monkeypatch.setattr(store, "embed_batch", lambda texts, preferred=None: embed(texts, "hashed-bag-of-words"))
    assert "Kubernetes" in store.query("README.md", "orchestration")[0]["content"]
    store.index_content("README.md", "## Travel\n- The museum opens at noon")
    assert store.query("README.md", "orchestration") == []
    assert store.index_status() == (1, "hashed-bag-of-words")


def test_cached_semantic_model_finds_paraphrases(store, monkeypatch):
    import os

    if os.getenv("RUN_LOCAL_MODEL_TESTS") != "1":
        pytest.skip("Set RUN_LOCAL_MODEL_TESTS=1 with the local MiniLM model cached")
    monkeypatch.setenv("EMBEDDING_BACKEND", "huggingface")
    store.index_content("README.md", "## Travel\n- The spare automobile key is in the striped biscuit tin.\n"
                        "## Kitchen\n- Bake the sourdough loaf for forty minutes.")
    assert store.index_status()[1].startswith("huggingface-local:")
    matches = store.query("README.md", "Where did I put the backup car keys?")
    assert matches and "striped biscuit tin" in matches[0]["content"]
    assert store.query("README.md", "Do I have anything about underwater archaeology?") == []


def test_queries_an_index_from_the_previous_release(store):
    old = store._get_client().create_collection("readme_README_md")
    old.add(ids=["section-2"], documents=["## Notes\n- The lockbox is red."],
            metadatas=[{"type": "section", "section": "Notes"}], embeddings=[[1., 0.]])
    assert "lockbox is red" in store.query("README.md", "lockbox")[0]["content"]
