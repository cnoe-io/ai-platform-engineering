from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from fastapi import UploadFile
from langchain_core.documents import Document
from common.utils import get_default_fresh_until

# ============================================================================
# Models for Ingestor ping and registration
# ============================================================================
class IngestorPingRequest(BaseModel):
    ingestor_type: str = Field(..., description="Type of the ingestor")
    ingestor_name: str = Field(..., description="Name of the ingestor")
    description: Optional[str] = Field("", description="Description of the ingestor")
    metadata: Optional[Dict[str, Any]] = Field({}, description="Additional metadata for the ingestor")

class IngestorPingResponse(BaseModel):
    ingestor_id: str = Field(..., description="Unique identifier for the ingestor")
    max_documents_per_ingest: int = Field(..., description="Maximum number of documents the server can handle per request")
    message: str = Field(..., description="Response message from the server")

# ============================================================================
# General Ingestor Models
# ============================================================================

class IngestorRequest(BaseModel):
    ingestor_id: str = Field(..., description="ID of the ingestor performing the ingestion")
    command: str = Field(..., description="Command to execute")
    payload: Optional[Any] = Field(..., description="Data associated with the command")

class DocumentIngestRequest(BaseModel):
    documents: List[Document] = Field(..., description="List of langchain Documents to ingest")
    ingestor_id: str = Field(..., description="ID of the ingestor ingesting these documents")
    datasource_id: str = Field(..., description="ID of the datasource associated with these documents")
    job_id: str = Field(None, description="Job ID associated with this ingestion")
    fresh_until: Optional[int] = Field(0, description="Timestamp until which this data is considered fresh (epoch seconds)")

# ============================================================================
# Models specific for Web Ingestor
# ============================================================================

class UrlIngestRequest(BaseModel):
    url: str = Field(..., description="URL to ingest")
    check_for_sitemaps: bool = Field(False, description="Whether to check for a sitemaps")
    sitemap_max_urls: int = Field(2000, description="Maximum number of URLs to fetch from sitemap - 0 means no limit", ge=0)
    description: str = Field("", description="Description for this data source")

class UrlReloadRequest(BaseModel):
    datasource_id: str = Field(..., description="ID of the URL datasource to reload")

class WebIngestorCommand(str, Enum):
    INGEST_URL = "ingest-url"
    RELOAD_ALL = "reload-all"
    RELOAD_DATASOURCE = "reload-datasource"

# ============================================================================
# Models for Graph Exploration and Querying
# ============================================================================
class ExploreDataEntityRequest(BaseModel):
    entity_type: str = Field(..., description="Type of the entity to fetch")
    entity_pk: str = Field(..., description="Primary key of the entity to fetch")

class ExploreEntityRequest(BaseModel):
    entity_type: Optional[str] = Field(None, description="Type of entity to explore")
    filter_by_properties: Optional[Dict[str, str]] = Field(None, description="Properties to filter by")

class ExploreRelationsRequest(BaseModel):
    from_type: Optional[str] = Field(None, description="Type of the source entity")
    to_type: Optional[str] = Field(None, description="Type of the target entity")
    relation_name: Optional[str] = Field(None, description="Name of the relation")
    filter_by_properties: Optional[Dict[str, str]] = Field(None, description="Properties to filter relations by")

# ============================================================================
# Models for Querying
# ============================================================================
class QueryRequest(BaseModel):
    query: str = Field(..., description="Query string to search for")
    limit: int = Field(3, description="Maximum number of results to return", ge=1, le=100)
    similarity_threshold: float = Field(0.3, description="Minimum similarity score", ge=0.0, le=1.0)
    filters: Optional[Dict[str, str|bool]] = Field(None, description="Additional filters as key-value pairs")
    ranker_type: str = Field("weighted", description="Type of ranker to use")
    ranker_params: Optional[Dict[str, Any]] = Field({"weights": [0.7, 0.3]}, description="Parameters for the ranker")

class QueryResult(BaseModel):
    document: Document
    score: float