# This file contains models for the knowledge graph
import hashlib
import json
from common.constants import ENTITY_TYPE_KEY, PRIMARY_ID_KEY, PROP_DELIMITER
from typing import Any, List, Optional
from pydantic import BaseModel, Field

# ============================================================================
# Models for graph entities and relations
# ============================================================================

class EntityIdentifier(BaseModel):
    """
    Represents an entity identifier to uniquely identify an entity in the graph database
    """
    entity_type: str
    primary_key: str

class Entity(BaseModel):
    """
    Represents an entity in the graph database
    """
    entity_type: str
    additional_labels: Optional[set[str]] = None
    all_properties: dict[str, Any] = Field(description="The properties of the entity")
    primary_key_properties: List[str] = Field(description="The primary key property of the entity")
    additional_key_properties: Optional[List[List[str]]] = Field(description="The secondary key properties of the entity", default=[])

    def generate_primary_key(self) -> str:
        """
        Generates a primary key for this entity from the primary key properties
        :return: str
        """
        return PROP_DELIMITER.join([str(self.all_properties[k]) for k in self.primary_key_properties])

    def get_identifier(self) -> EntityIdentifier:
        """
        Generates an entity identifier for this entity
        :return: EntityIdentifier
        """
        return EntityIdentifier(entity_type=self.entity_type, primary_key=self.generate_primary_key())

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

    def get_hash(self) -> str:
        """
        Generates a hash for this entity's properties
        :return: str
        """
        external_props = self.get_external_properties()
        external_props[ENTITY_TYPE_KEY] = self.entity_type
        json_str = json.dumps(external_props, sort_keys=True, default=str)
        return hashlib.sha256(json_str.encode("utf-8")).hexdigest()
    

    def summary(self) -> dict[str, str]:
        """
        Generates a summary of the entity
        This is used to provide a quick overview of the entity
        :return: dict[str, str]
        """
        summary_dict = {
            ENTITY_TYPE_KEY: self.entity_type,
            PRIMARY_ID_KEY: self.generate_primary_key()
        }
        for prop in self.primary_key_properties:
            summary_dict[prop] = self.all_properties.get(prop, "")
        if self.additional_key_properties is not None and len(self.additional_key_properties) > 0:
            for key in self.additional_key_properties:
                for prop in key:
                    summary_dict[prop] = self.all_properties.get(prop, "")
        return summary_dict


class Relation(BaseModel):
    """
    Represents a relationship between two entities in the graph database
    """
    from_entity: EntityIdentifier = Field(description="The from entity")
    to_entity: EntityIdentifier = Field(description="The to entity")
    relation_name: str = Field(description="The name of the relation")
    relation_properties: Optional[dict[str, Any]] = Field(description="(Optional) The properties of the relation")

class EntityTypeMetaRelation(BaseModel):
    """
    Represents a meta relationship between two entity types in the graph database
    It maybe used to approximate a relationship between two entity types
    """
    from_entity_type: str = Field(description="The from entity type")
    to_entity_type: str = Field(description="The to entity type")
    relation_name: str = Field(description="The name of the relation")