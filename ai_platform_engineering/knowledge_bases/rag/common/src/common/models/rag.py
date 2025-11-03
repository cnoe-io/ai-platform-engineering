# This file contains models for the RAG server
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Type
import datetime
import hashlib

DocTypeText = "text"
DocTypeGraphEntity = "graph_entity"

doc_types = [DocTypeText, DocTypeGraphEntity]

############################################################################
# Models for vector DB metadata
############################################################################

class VectorDBBaseMetadata(BaseModel):
    id: str = Field(..., description="Unique identifier for the vector DB record")
    doc_type: str = Field(..., description="Type of the document chunk, e.g. 'text', 'graph_entity', etc.")
    datasource_id: Optional[str] = Field(..., description="Datasource ID this record belongs to")
    chunk_index: Optional[int] = Field(..., description="Index of the chunk within the document")
    total_chunks: Optional[int] = Field(..., description="Total number of chunks in the document")

class VectorDBTextMetadata(VectorDBBaseMetadata):
    document_id: Optional[str] = Field(..., description="Document ID this record belongs to")

class VectorDBGraphMetadata(VectorDBBaseMetadata):
    graph_connector_id: Optional[str] = Field(..., description="Connector ID this record belongs to")
    graph_entity_type: Optional[str] = Field(..., description="Type of the entity")
    graph_entity_primary_key: Optional[str] = Field(..., description="Primary key of the entity")
    graph_entity_hash: Optional[str] = Field(..., description="Hash of the entity data")


def valid_metadata_keys(metadata_list_override: List[Type[BaseModel]] = []) -> List[str]:
    """
    Convenience method to get all valid metadata keys for filtering
    Args:
        metadata_list_override: Optional list of metadata models to use instead of default ones, by default uses all defined metadata models
    Returns:
        List of valid metadata keys for metadata models
    """
    search_filter_keys = set()
    if metadata_list_override:
        metadata_list = metadata_list_override
    else:
        metadata_list = [VectorDBGraphMetadata, VectorDBTextMetadata, VectorDBBaseMetadata]
    for record in metadata_list:
        search_filter_keys.update(record.model_fields.keys())
    return list(search_filter_keys)

############################################################################
# Models for metadata about connectors, datasources and documents
############################################################################

class GraphConnectorInfo(BaseModel):
    connector_id: str = Field(..., description="Unique identifier for the graph connector") # TODO: Implement ID generation
    connector_type: str = Field(..., description="Type of the graph connector")
    connector_name: str = Field(..., description="Name of the graph connector")
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
    check_for_site_map: bool = Field(False, description="Whether to check for a sitemap")
    sitemap_max_urls: int = Field(2000, description="Maximum number of URLs to fetch from sitemap - 0 means no limit", ge=0)
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