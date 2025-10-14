# This file contains models for the RAG server
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import datetime
import hashlib

class VectorDBDocsMetadata(BaseModel):
    id: str = Field(..., description="Unique identifier for the vector DB record")
    datasource_id: str = Field(..., description="Datasource ID this record belongs to")
    document_id: str = Field(..., description="Document ID this record belongs to")
    chunk_index: int = Field(..., description="Index of the chunk within the document")
    total_chunks: int = Field(..., description="Total number of chunks in the document")

class VectorDBGraphMetadata(BaseModel):
    hash: str = Field(..., description="Hash of the entity data")
    connector_id: str = Field(..., description="Connector ID this record belongs to")
    entity_type: str = Field(..., description="Type of the entity")
    entity_primary_key: str = Field(..., description="Primary key of the entity")

class GraphConnectorInfo(BaseModel):
    connector_id: str = Field(..., description="Unique identifier for the graph connector") # TODO: Implement ID generation
    name: str = Field(..., description="Name of the graph connector")
    description: Optional[str] = Field(None, description="Description of the graph connector")
    last_seen: Optional[datetime.datetime] = Field(None, description="Last time the connector was seen")

class DataSourceInfo(BaseModel):
    datasource_id: str = Field(..., description="Unique identifier for the source")
    description: str = Field(..., description="Description of the source")
    source_type: str = Field(..., description="Type of the source")
    path: str = Field(..., description="The source path, e.g. path for folder or URL for sitemap or S3 path for S3 bucket")
    created_at: datetime.datetime = Field(..., description="When the source was first ingested")
    last_updated: datetime.datetime = Field(..., description="When the source was last updated")
    default_chunk_size: int = Field(10000, description="Default chunk size for this datasource, applies to all documents unless overridden")
    default_chunk_overlap: int = Field(2000, description="Default chunk overlap for this datasource, applies to all documents unless overridden")
    total_documents: int = Field(0, description="Total number of documents in this source") # Adding this for convenience
    total_chunks: int = Field(0, description="Total number of chunks in this source") # Adding this for convenience
    job_id: Optional[str] = Field(None, description="Job ID associated with this source")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

    @staticmethod
    def generate_id_from_url(url: str) -> str:
        """Generate a unique source ID based on URL"""
        source_hash = hashlib.md5(url.encode()).hexdigest()[:12]
        return f"src_{url.replace('.', '_')}_{source_hash}"

class DocumentInfo(BaseModel):
    document_id: str = Field(..., description="Unique identifier for the document")
    datasource_id: str = Field(..., description="Datasource ID this document belongs to")
    path: str = Field(..., description="Document path, e.g. file path or URL")
    title: str = Field("", description="Document title")
    description: str = Field("", description="Document description")
    content_length: int = Field(0, description="Original content length")
    chunk_count: int = Field(0, description="Number of chunks this document was split into")
    chunk_size: int = Field(10000, description="Chunk size used for this document")
    chunk_overlap: int = Field(2000, description="Chunk overlap used for this document")
    created_at: datetime.datetime = Field(..., description="When the document was processed")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

    @staticmethod
    def generate_id_from_url(datasource_id: str, url: str) -> str:
        """Generate a unique document ID based on datasource ID and URL"""
        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
        return f"{datasource_id}_doc_{url_hash}"