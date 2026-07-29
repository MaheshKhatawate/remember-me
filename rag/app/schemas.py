from typing import List, Optional

from pydantic import BaseModel, Field


class IndexRequest(BaseModel):
    source_path: str = Field(default="README.md")
    content: str = Field(default="")


class IndexResponse(BaseModel):
    source_path: str
    chunks: int


class QueryRequest(BaseModel):
    source_path: str = Field(default="README.md")
    query: str
    top_k: int = Field(default=4, ge=1, le=20)


class SearchResult(BaseModel):
    section: Optional[str] = None
    title: Optional[str] = None
    content: str
    score: float


class QueryResponse(BaseModel):
    query: str
    results: List[SearchResult]


class HealthResponse(BaseModel):
    status: str
    embedding_backend: str
    vector_store: str
    indexed_sources: int
