# This file contains models for the RAG server
from pydantic import BaseModel, Field, model_validator
from typing import List, Optional, Dict, Any

from common.constants import DEFAULT_RELOAD_INTERVAL, PROP_DELIMITER

# ============================================================================
# Models for structured entities (entity-based documents in vector DB)
# ============================================================================


class StructuredEntityId(BaseModel):
  """
  Represents a structured entity identifier to uniquely identify a structured entity
  """

  entity_type: str
  primary_key: str


class StructuredEntity(BaseModel):
  """
  Represents a structured entity - an entity-based document that can be stored in the vector DB
  and optionally synced to a graph database.
  """

  entity_type: str
  additional_types: Optional[set[str]] = None
  all_properties: dict[str, Any] = Field(description="The properties of the entity")
  primary_key_properties: List[str] = Field(description="The primary key property of the entity")
  additional_key_properties: Optional[List[List[str]]] = Field(description="The secondary key properties of the entity", default=[])

  def generate_primary_key(self) -> str:
    """
    Generates a primary key for this entity from the primary key properties
    :return: str
    """
    return PROP_DELIMITER.join([str(self.all_properties[k]) for k in self.primary_key_properties])

  def get_identifier(self) -> StructuredEntityId:
    """
    Generates a structured entity identifier for this entity
    :return: StructuredEntityId
    """
    return StructuredEntityId(entity_type=self.entity_type, primary_key=self.generate_primary_key())

  def get_external_properties(self) -> dict[str, Any]:
    """
    Returns all properties that are not internal (i.e., do not start with _)
    :return: dict[str, Any]
    """
    external_props = {}
    for prop, val in self.all_properties.items():
      if prop.startswith("_"):
        continue
      external_props[prop] = val
    return external_props


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
  ingestor_id: str = Field(..., description="Unique identifier for the ingestor")  # TODO: Implement proper ID generation
  ingestor_type: str = Field(..., description="Type of the ingestor")
  ingestor_name: str = Field(..., description="Name of the ingestor")
  description: Optional[str] = Field(default="", description="Description of the ingestor")
  metadata: Optional[Dict[str, Any]] = Field({}, description="Additional metadata about the ingestor")
  last_seen: Optional[int] = Field(0, description="Last time the ingestor was seen")


class DataSourceInfo(BaseModel):
  datasource_id: str = Field(..., description="Unique identifier for the data source")
  ingestor_id: str = Field(..., description="Ingestor ID this data source belongs to")
  description: str = Field(default="", description="Description of the data source")
  source_type: str = Field(..., description="Type of the data source")
  last_updated: Optional[int] = Field(..., description="When the data source was last updated")
  default_chunk_size: Optional[int] = Field(default=10000, description="Default chunk size for this data source, applies to all documents unless overridden")
  default_chunk_overlap: Optional[int] = Field(default=2000, description="Default chunk overlap for this data source, applies to all documents unless overridden")
  reload_interval: int = Field(default=DEFAULT_RELOAD_INTERVAL, description="Reload interval in seconds. Used to calculate fresh_until and next reload time.")
  metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

  @model_validator(mode="before")
  @classmethod
  def migrate_reload_interval(cls, values: Any) -> Any:
    """
    Migration: If reload_interval not in input, check metadata for legacy value.
    This handles existing datasources that stored reload_interval in metadata.
    """
    if not isinstance(values, dict):
      return values
    if values.get("reload_interval") is None:
      metadata = values.get("metadata") or {}
      legacy_value = metadata.get("reload_interval")
      if legacy_value is not None:
        values["reload_interval"] = legacy_value
    return values


class DocumentMetadata(BaseModel):
  document_id: str = Field(..., description="Unique identifier for the document, for structured entities this would be populated automatically based on entity_type and entity_pk")
  datasource_id: str = Field(..., description="Datasource ID this document belongs to")
  ingestor_id: str = Field(..., description="Ingestor ID this datasource belongs to")
  title: str = Field(default="", description="Document title")
  description: str = Field(default="", description="Document description")
  is_structured_entity: bool = Field(default=False, description="Whether this document represents a structured entity")
  document_type: str = Field(..., description="Type of the document, e.g. 'text', 'markdown', 'pdf', etc. For structured entities, this would be populated automatically based on entity_type")
  document_ingested_at: Optional[int] = Field(..., description="When the document was ingested")
  fresh_until: Optional[int] = Field(..., description="Fresh until timestamp for the document, after which it should be re-ingested")
  metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class DocumentChunkMetadata(DocumentMetadata):  # Inherits from DocumentMetadata
  id: str = Field(..., description="Unique identifier for the document chunk")
  chunk_index: int = Field(..., description="Index of the chunk within the document")
  total_chunks: int = Field(..., description="Total number of chunks in the document")


# ============================================================================
# Models for MCP tool configuration
# ============================================================================


class MCPBuiltinToolsConfig(BaseModel):
  """Enable/disable flags for built-in MCP tools."""

  search_enabled: bool = True
  fetch_document_enabled: bool = True
  fetch_datasources_enabled: bool = True
  # Individual graph tool toggles (only active when graph_rag_enabled=True on server)
  graph_explore_ontology_entity_enabled: bool = True
  graph_explore_data_entity_enabled: bool = True
  graph_fetch_data_entity_details_enabled: bool = True
  graph_shortest_path_between_entity_types_enabled: bool = True
  graph_raw_query_data_enabled: bool = True
  graph_raw_query_ontology_enabled: bool = True

  @model_validator(mode="before")
  @classmethod
  def _migrate_graph_tools_enabled(cls, data: Any) -> Any:
    """Backward compat: if old 'graph_tools_enabled' key is present,
    fan it out to the six individual flags and drop it."""
    if isinstance(data, dict) and "graph_tools_enabled" in data:
      val = data.pop("graph_tools_enabled")
      for key in (
        "graph_explore_ontology_entity_enabled",
        "graph_explore_data_entity_enabled",
        "graph_fetch_data_entity_details_enabled",
        "graph_shortest_path_between_entity_types_enabled",
        "graph_raw_query_data_enabled",
        "graph_raw_query_ontology_enabled",
      ):
        data.setdefault(key, val)
    return data


class ParallelSearch(BaseModel):
  """One leg of a parallel search. Each entry in MCPToolConfig.parallel_searches
  becomes a concurrent vector-DB query whose results are returned under its label.
  """

  label: str = Field(..., description="Key used in the response dict for this search's results")
  datasource_ids: List[str] = Field(default_factory=list, description="Datasource IDs (or prefix patterns ending with *) to restrict this search. Empty = all.")
  extra_filters: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata filters applied to this search (e.g. is_structured_entity, document_type)")
  semantic_weight: float = Field(default=0.5, ge=0.0, le=1.0, description="Semantic (dense) weight for this search. Keyword weight = 1.0 - this value.")

  @model_validator(mode="before")
  @classmethod
  def _migrate_is_structured_entity(cls, data: Any) -> Any:
    """Migration: Move is_structured_entity into extra_filters if present at top level."""
    if not isinstance(data, dict):
      return data
    if "is_structured_entity" in data:
      val = data.pop("is_structured_entity")
      if val is not None:
        extra = data.get("extra_filters") or {}
        extra["is_structured_entity"] = val
        data["extra_filters"] = extra
    return data


class MCPToolConfig(BaseModel):
  """Configuration for a custom MCP search tool."""

  tool_id: str = Field(..., description="Slug used as the MCP tool name, e.g. 'infra_search'")
  description: str = Field(default="", description="Tool description shown to the LLM agent")
  parallel_searches: List[ParallelSearch] = Field(default_factory=lambda: [ParallelSearch(label="results")], description="One or more parallel sub-searches. Response is a dict keyed by label.")
  allow_runtime_filters: bool = Field(default=False, description="If True, expose a 'filters' parameter so the LLM can pass extra filters per-call.")
  enabled: bool = True
  created_at: int = Field(default=0, description="Unix timestamp of creation")
  updated_at: int = Field(default=0, description="Unix timestamp of last update")
