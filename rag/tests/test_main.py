import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CHROMA_PERSIST_DIR", str(tmp_path / "chroma"))
    monkeypatch.setenv("EMBEDDING_BACKEND", "hash")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("HUGGINGFACE_API_KEY", raising=False)

    from app import store as store_module

    importlib.reload(store_module)

    from app import main as main_module

    importlib.reload(main_module)
    return TestClient(main_module.app)


README = """# Project

## Links

- [Docker](https://docker.com) - Container platform
- [Kubernetes](https://kubernetes.io) - Container orchestration
"""


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["vector_store"] == "chromadb"


def test_index_endpoint(client):
    response = client.post("/index", json={"source_path": "README.md", "content": README})
    assert response.status_code == 200
    assert response.json()["chunks"] > 0


def test_query_endpoint_after_indexing(client):
    client.post("/index", json={"source_path": "README.md", "content": README})
    response = client.post(
        "/query",
        json={"source_path": "README.md", "query": "container orchestration", "top_k": 2},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["query"] == "container orchestration"
    assert len(body["results"]) > 0


def test_query_endpoint_before_indexing_returns_empty(client):
    response = client.post(
        "/query",
        json={"source_path": "README.md", "query": "anything", "top_k": 3},
    )
    assert response.status_code == 200
    assert response.json()["results"] == []
