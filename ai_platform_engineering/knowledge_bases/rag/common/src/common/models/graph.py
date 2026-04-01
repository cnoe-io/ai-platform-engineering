# This file contains models for the knowledge graph
from typing import Any, Optional
from pydantic import BaseModel, Field

from common.models.rag import StructuredEntity, StructuredEntityId

# ============================================================================
# Deprecation aliases - use StructuredEntity/StructuredEntityId from models.rag instead
# ============================================================================

Entity = StructuredEntity
EntityIdentifier = StructuredEntityId

# ============================================================================
# Models for graph relations (these stay in graph.py as they are graph-specific)
# ============================================================================


class Relation(BaseModel):
  """
  Represents a relationship between two entities in the graph database.
  Uniquely identified by: (from_entity.entity_type, to_entity.entity_type, relation_name, relation_pk)
  """

  from_entity: StructuredEntityId = Field(description="The from entity")
  to_entity: StructuredEntityId = Field(description="The to entity")
  relation_name: str = Field(description="The name of the relation")
  relation_pk: str = Field(description="The primary key for this relation - used to uniquely identify relations with the same name between the same entity types")
  relation_properties: Optional[dict[str, Any]] = Field(description="(Optional) The properties of the relation")


class EntityTypeMetaRelation(BaseModel):
  """
  Represents a meta relationship between two entity types in the graph database
  It maybe used to approximate a relationship between two entity types
  """

  from_entity_type: str = Field(description="The from entity type")
  to_entity_type: str = Field(description="The to entity type")
  relation_name: str = Field(description="The name of the relation")
