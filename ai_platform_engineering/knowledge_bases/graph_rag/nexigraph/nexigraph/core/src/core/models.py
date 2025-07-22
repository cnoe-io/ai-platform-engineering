from enum import Enum
from typing import Annotated, Any, List, Optional, TypedDict
from pydantic import BaseModel, Field, WithJsonSchema

from core.constants import ENTITY_TYPE_KEY, PRIMARY_ID_KEY, PROP_DELIMITER

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
        return PROP_DELIMITER.join([self.all_properties[k] for k in self.primary_key_properties])

    def get_identifier(self) -> EntityIdentifier:
        """
        Generates an entity identifier for this entity
        :return: EntityIdentifier
        """
        return EntityIdentifier(entity_type=self.entity_type, primary_key=self.generate_primary_key())

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
    from_entity: EntityIdentifier
    to_entity: EntityIdentifier
    relation_name: str
    relation_properties: Optional[dict[str, Any]] = None

class EntityTypeMetaRelation(BaseModel):
    """
    Represents a meta relationship between two entity types in the graph database
    It maybe used to approximate a relationship between two entity types
    """
    from_entity_type: str
    to_entity_type: str
    relation_name: str

class KnowledgeSource(BaseModel):
    """
    Represents a knowledge source for an entity type
    """
    name: str
    doc_type: str
    content: str


# # # # # # # # # # # # # # # # # # # #
# Foreign key agent and heuristic related classes
# # # # # # # # # # # # # # # # # # # # 
class ExampleEntityMatch(TypedDict):
    """
    Represents an example match of two entities in the foreign key heuristic
    """
    entity_a_id: str
    entity_b_id: str


class PropertyMapping(BaseModel):
    """
    Represents a composite key property mapping in the foreign key heuristic
    """
    entity_a_property: str = Field(description="The property of the first entity")
    entity_b_idkey_property: str = Field(description="The identity key property of the second entity that is matched")


class FkeyRelationManualIntervention(str, Enum):
    """
    Represents the manual intervention options for the foreign key heuristic
    """
    NONE = "none"
    ACCEPTED = "accepted"
    REJECTED = "rejected"

class FkeyHeuristic(BaseModel):
    """
    Represents the heuristics used to identify foreign key relationships
    """
    # Properties that are used to identify the foreign key relationship, and are exposed to agent
    entity_a_type: Annotated[str, WithJsonSchema({'prompt_exposed': "true"}) ] = Field(description="The entity type of the first entity")
    entity_b_type: Annotated[str, WithJsonSchema({'prompt_exposed': "true"}) ] = Field(description="The entity type of the second entity")
    entity_a_property: Annotated[str, WithJsonSchema({'prompt_exposed': "true"}) ] = Field(description="The property of the first entity")
    count: Annotated[int, WithJsonSchema({'prompt_exposed': "true"}) ] = Field(default=0, description="The number of times the properties match up")
    example_matches: Annotated[List[ExampleEntityMatch], WithJsonSchema({'prompt_exposed': "true"}) ] = Field(description="Example entities that match the heuristic")

    # Properties that store information about the heuristic, not exposed to agent
    properties_in_composite_idkey: frozenset[str] = Field(description="The properties of entity_b that are part of the composite identity key, if applicable")
    property_mappings: List[PropertyMapping] = Field(
        description="Properties in entity_a that map to the composite identity key properties of entity_b",
    )
    last_processed: int = Field(default=0, description="The last time this heuristic was processed, used to determine freshness")

class FkeyEvaluation(BaseModel):
    """
    Represents the evaluation of a foreign key heuristic
    This is used to store the evaluation information and the heuristic used to identify it
    """
    relation_name: Optional[str] = Field(default="", description="The name of the relation, e.g. 'HAS', 'IS_A', 'BELONGS_TO', etc.")
    relation_confidence: float = Field(ge=0, le=1, description="The confidence of the relation between 0 and 1")
    justification: Optional[str] = Field(default="", description="Justification for the relation and the confidence")
    thought: str = Field(default="", description="The agent's thoughts about the relation")
    last_evaluated: int = Field(default=0, description="The last time this heuristic was evaluated, used to determine freshness")
    values: List[Any] = Field(default=[], description="The example values that were used to evaluate the heuristic")
    entity_a_with_property_count: int = Field(default=0, description="The number of entities of entity_a type that have the property that matches the heuristic")
    entity_a_with_property_percentage: float = Field(default=0, description="The percentage of entity_a properties that match the heuristic")
    last_evaluation_count: int = Field(default=0, description="The previous count of the heuristic, used to determine if the heuristic has changed")

class RelationCandidate(BaseModel):
    """
    Represents a candidate for a foreign key relation
    This is used to store the relation information and the heuristic used to identify it
    """
    relation_id: str = Field(description="The unique identifier for the relation, usually a hash of the relation properties")
    heuristic: FkeyHeuristic = Field(description="The heuristic and metrics used to identify the relation")

    # Properties that are used store information about the state of the relation, not exposed to agent
    is_applied: Optional[bool] = False
    manually_intervened: Optional[FkeyRelationManualIntervention] = FkeyRelationManualIntervention.NONE
    evaluation_error_message: Optional[str] = Field(default="", description="Error message if the heuristic failed to apply") # Only used for debugging/troubleshooting purposes

    evaluation: Optional[FkeyEvaluation] = Field(
        default=None,
        description="The evaluation of the relation, if it has been evaluated",
    )


class AgentOutputFKeyRelation(BaseModel):
    """
    Represents the output of the foreign key relation agent
    """
    relation_confidence: Optional[float] = Field(description="The confidence in this relation between 0 and 1")
    relation_name: str = Field(description="The name of the relation, e.g. 'HAS', 'IS_A', 'BELONGS_TO', etc.")
    justification: str = Field(description="Brief justification for the relation and the confidence")


