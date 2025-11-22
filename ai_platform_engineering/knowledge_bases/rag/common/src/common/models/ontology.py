# This file contains models for the ontology
from enum import Enum
from typing import Annotated, Any, List, Optional, TypedDict
from pydantic import BaseModel, Field, WithJsonSchema

# ============================================================================
# Models for ontology management
# ============================================================================

class ExampleEntityMatch(TypedDict):
    """
    Represents an example match of two entities in the foreign key heuristic
    """
    entity_a_pk: str
    entity_b_pk: str


class PropertyMapping(BaseModel):
    """
    Represents a composite key property mapping in the foreign key heuristic
    """
    entity_a_property: str = Field(description="The property of the first entity")
    entity_b_idkey_property: str = Field(description="The identity key property of the second entity that is matched")

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

class FkeyEvaluationResult(str, Enum):
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    UNSURE = "UNSURE"

class FkeyEvaluation(BaseModel):
    """
    Represents the evaluation of a foreign key heuristic
    This is used to store the evaluation information and the heuristic used to identify it
    """
    relation_name: str = Field(description="The name of the relation, e.g. 'HAS', 'IS_A', 'BELONGS_TO', etc.")
    result: FkeyEvaluationResult = Field(default=FkeyEvaluationResult.UNSURE, description="The state of the evaluation, e.g. 'ACCEPTED', 'REJECTED', 'UNSURE', etc.")
    justification: Optional[str] = Field(default="", description="Justification for the relation and the confidence")
    thought: str = Field(default="", description="The agent's thoughts about the relation")
    last_evaluated: int = Field(default=0, description="The last time this heuristic was evaluated, used to determine freshness")
    is_manual: bool = Field(default=False, description="Whether this evaluation was done manually by a human")

class RelationCandidate(BaseModel):
    """
    Represents a candidate for a relation
    This is used to store the relation information and the heuristic used to identify it
    """
    relation_id: str = Field(description="The unique identifier for the relation, usually a hash of the relation properties")
    heuristic: FkeyHeuristic = Field(description="The heuristic and metrics used to identify the relation")

    # Properties that are used store information about the state of the relation
    is_synced: Optional[bool] = Field(default=False, description="Whether the candidate is synced with the graph database")
    last_synced: Optional[int] = Field(default=0, description="The last time this candidate was synced with the graph database")
    error_message: Optional[str] = Field(default="", description="Error message when evaluating or processing the candidate")
    evaluation: Optional[FkeyEvaluation] = Field(default=None, description="The evaluation of the relation, if it has been evaluated")

class AgentOutputFKeyRelation(BaseModel):
    """
    Represents the output of the ontology agent
    """
    result: FkeyEvaluationResult = Field(description="The result of the evaluation, output one of ACCEPTED, REJECTED, UNSURE")
    relation_name: str = Field(description="The name of the relation, e.g. 'HAS', 'IS_A', 'BELONGS_TO', etc.")
    justification: str = Field(description="Brief justification for the relation and the confidence")


