from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from fastapi import UploadFile
from langchain_core.documents import Document
from common.models.graph import Entity

# ============================================================================
# Models used by the API
# ============================================================================

# Data Source models
class DataSourceConfig(BaseModel):
    url: str = Field(..., description="Source URL")
    chunk_size: int = Field(10000, description="Default size of text chunks for documents from this source", ge=100, le=50000)
    chunk_overlap: int = Field(2000, description="Default overlap between chunks for documents from this source", ge=0, le=5000)
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class DataSourceReloadRequest(BaseModel):
    datasource_id: str = Field(..., description="ID of the datasource to reload")

# Ingestion models
class UrlIngest(BaseModel):
    url: str = Field(..., description="URL to ingest")
    check_for_site_map: bool = Field(False, description="Whether to check for a sitemaps")
    sitemap_max_urls: int = Field(2000, description="Maximum number of URLs to fetch from sitemap - 0 means no limit", ge=0)
    description: str = Field("", description="Description for this data source")
    default_chunk_size: int = Field(10000, description="Default size of text chunks for documents from this source", ge=100, le=50000)
    default_chunk_overlap: int = Field(2000, description="Default overlap between chunks for documents from this source", ge=0, le=5000)

class FileIngest(BaseModel):
    file: UploadFile = Field(..., description="File to ingest")
    description: Optional[str] = Field(None, description="Description for this data source")
    default_chunk_size: int = Field(10000, description="Default size of text chunks for documents from this source", ge=100, le=50000)
    default_chunk_overlap: int = Field(2000, description="Default overlap between chunks for documents from this source", ge=0, le=5000)

class IngestResponse(BaseModel):
    job_id: str

# Graph Explorations models
class EntityIngest(BaseModel):
    entity_type: str = Field(..., description="Type of the entity")
    connector_name: str = Field(..., description="Name of the connector submitting the entities")
    entities: List[Entity] = Field(..., description="List of entities to ingest")
    fresh_until: int = Field(0, description="Fresh until timestamp")

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

# Query models
class QueryRequest(BaseModel):
    query: str = Field(..., description="Query string to search for")
    limit: int = Field(3, description="Maximum number of results to return", ge=1, le=100)
    similarity_threshold: float = Field(0.3, description="Minimum similarity score", ge=0.0, le=1.0)
    filters: Optional[Dict[str, str]] = Field(None, description="Additional filters as key-value pairs")
    ranker_type: str = Field("weighted", description="Type of ranker to use")
    ranker_params: Optional[Dict[str, Any]] = Field({"weights": [0.7, 0.3]}, description="Parameters for the ranker")

class QueryResult(BaseModel):
    document: Document
    score: float

class QueryResults(BaseModel):
    query: str
    results: List[QueryResult] 