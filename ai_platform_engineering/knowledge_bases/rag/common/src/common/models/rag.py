# This file contains models for the RAG server
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

# ============================================================================
# Models for vector DB metadata
# ============================================================================

def valid_metadata_keys() -> List[str]:
    """
    Convenience method to get all valid metadata keys for filtering
    Args:
        metadata_list_override: Optional list of metadata models to use instead of default ones, by default uses all defined metadata models
    Returns:
        List of valid metadata keys for metadata models
    """
    search_filter_keys = set()
    search_filter_keys.update(DocumentMetadata.model_fields.keys())
    return list(search_filter_keys)

# ============================================================================
# Models for metadata about ingestors, datasources and documents
# ============================================================================

class IngestorInfo(BaseModel):
    ingestor_id: str = Field(..., description="Unique identifier for the ingestor") # TODO: Implement proper ID generation
    ingestor_type: str = Field(..., description="Type of the ingestor")
    ingestor_name: str = Field(..., description="Name of the ingestor")
    description: Optional[str] = Field("", description="Description of the ingestor")
    metadata: Optional[Dict[str, Any]] = Field({}, description="Additional metadata about the ingestor")
    last_seen: Optional[int] = Field(0, description="Last time the ingestor was seen")

class DataSourceInfo(BaseModel):
    datasource_id: str = Field(..., description="Unique identifier for the data source")
    ingestor_id: str = Field(..., description="Ingestor ID this data source belongs to")
    description: str = Field(..., description="Description of the data source")
    source_type: str = Field(..., description="Type of the data source")
    last_updated: Optional[int] = Field(..., description="When the data source was last updated")
    default_chunk_size: int = Field(10000, description="Default chunk size for this data source, applies to all documents unless overridden")
    default_chunk_overlap: int = Field(2000, description="Default chunk overlap for this data source, applies to all documents unless overridden")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class DocumentMetadata(BaseModel):
    document_id: str = Field(..., description="Unique identifier for the document, for graph entities this would be populated automatically based on entity_type and entity_pk")
    datasource_id: str = Field(..., description="Datasource ID this document belongs to")
    ingestor_id: str = Field(..., description="Ingestor ID this datasource belongs to")
    title: str = Field("", description="Document title")
    description: str = Field("", description="Document description")
    is_graph_entity: bool = Field(False, description="Whether this document represents a graph entity")
    document_type: str = Field(..., description="Type of the document, e.g. 'text', 'markdown', 'pdf', etc. For graph entities, this would be populated automatically based on entity_type")
    document_ingested_at: Optional[int] = Field(..., description="When the document was ingested")
    fresh_until: Optional[int] = Field(0, description="Fresh until timestamp for the document, after which it should be re-ingested")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class DocumentChunkMetadata(DocumentMetadata): # Inherits from DocumentMetadata
    id: str = Field(..., description="Unique identifier for the document chunk")
    chunk_index: int = Field(..., description="Index of the chunk within the document")
    total_chunks: int = Field(..., description="Total number of chunks in the document")
    
