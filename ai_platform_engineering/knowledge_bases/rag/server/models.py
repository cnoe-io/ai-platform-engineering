from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from fastapi import UploadFile
from langchain_core.documents import Document

from .redis_client import SourceInfo

# Configuration models
class SourceConfig(BaseModel):
    url: str = Field(..., description="Source URL")
    chunk_size: int = Field(10000, description="Default size of text chunks for documents from this source", ge=100, le=50000)
    chunk_overlap: int = Field(2000, description="Default overlap between chunks for documents from this source", ge=0, le=5000)
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class ConfigRequest(BaseModel):
    url: str = Field(..., description="Source URL")
    chunk_size: int = Field(10000, description="Default size of text chunks for documents from this source", ge=100, le=50000)
    chunk_overlap: int = Field(2000, description="Default overlap between chunks for documents from this source", ge=0, le=5000)
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class ConfigResponse(BaseModel):
    success: bool
    message: str
    source_info: Optional[SourceInfo] = None

# Ingestion models
class UrlIngest(BaseModel):
    url: str = Field(..., description="URL to ingest")
    params: Optional[Dict[str, Any]] = Field(None, description="Additional parameters")

class FileIngest(BaseModel):
    file: UploadFile = Field(..., description="File to ingest")
    params: Optional[Dict[str, Any]] = Field(None, description="Additional parameters")

class IngestResponse(BaseModel):
    job_id: str
    status: str
    message: str
    source_id: Optional[str] = None

# Query models
class QueryRequest(BaseModel):
    query: str = Field(..., description="Query string to search for")
    limit: int = Field(3, description="Maximum number of results to return", ge=1, le=100)
    similarity_threshold: float = Field(0.7, description="Minimum similarity score", ge=0.0, le=1.0)
    source_id: Optional[str] = Field(None, description="Filter by specific source ID")

class QueryResult(BaseModel):
    query: str
    results: List[Document] 