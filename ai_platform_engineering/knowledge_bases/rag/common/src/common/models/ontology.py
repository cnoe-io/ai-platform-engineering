# This file contains models for the ontology
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import Annotated, Any, List, Optional, TypedDict
from pydantic import BaseModel, Field, WithJsonSchema

# ============================================================================
# Models for ontology management
# ============================================================================

class ValueMatchType(str, Enum):
    """Enum for value match types between entity properties"""
    EXACT = "exact"
    PREFIX = "prefix"
    SUFFIX = "suffix"
    SUBSET = "subset"
    SUPERSET = "superset"
    CONTAINS = "contains"
    NONE = "none"

class ExampleEntityMatch(TypedDict):
    """
    Represents an example match of two entities in the foreign key heuristic
    """
    entity_a_pk: str
    entity_b_pk: str


class PropertyMappingStructure(BaseModel):
    """
    Represents the structural definition of a property mapping.
    Just defines WHICH properties map, without match type or quality information.
    Used in: FkeyHeuristic (to define relationship structure)
    """
    entity_a_property: str = Field(description="The property of the first entity")
    entity_b_idkey_property: str = Field(description="The identity key property of the second entity that is matched")


class PropertyMappingRule(BaseModel):
    """
    Represents a property mapping rule for applying relationships.
    Specifies WHICH properties map and HOW to match them (match type), but not quality (which is observed, not decided).
    Used in: FkeyEvaluation (to specify how to apply the relationship)
    """
    entity_a_property: str = Field(description="The property of the first entity")
    entity_b_idkey_property: str = Field(description="The identity key property of the second entity that is matched")
    match_type: ValueMatchType = Field(default=ValueMatchType.EXACT, description="Type of match to use when applying: exact, prefix, suffix, subset, superset, contains")


class PropertyMapping(BaseModel):
    """
    Represents a property mapping with observed match type and quality.
    Used for OBSERVED matches (what we found in the data).
    
    Used in:
    - DeepPropertyMatch: Observation of how properties matched with quality metrics
    """
    entity_a_property: str = Field(description="The property of the first entity")
    entity_b_idkey_property: str = Field(description="The identity key property of the second entity that is matched")
    match_type: ValueMatchType = Field(default=ValueMatchType.EXACT, description="Type of match observed: exact, prefix, suffix, subset, superset, contains")
    value_match_quality: float = Field(default=1.0, description="Quality of the value match observed (0.0-1.0)")


@dataclass
class DeepPropertyMatch:
    """Represents a deep property match between two entities."""
    search_entity_type: str
    search_entity_pk: str
    search_entity_property: str
    search_entity_property_value: str
    matched_entity_type: str
    matched_entity_pk: str
    matched_entity_idkey: dict[str, Any]
    matched_entity_idkey_property: str
    matching_properties: List[PropertyMapping]
    bm25_score: float  # BM25 score from fuzzy search
    deep_match_quality: float  # Overall quality score for this deep match - includes - bm25 score, quality of the property mapping matches, and uniqueness/simplicity/exactness bonuses
    # Optional field for batch heuristic updates (set later in processing)
    relation_id: str | None = None

class FkeyHeuristic(BaseModel):
    """
    Represents the aggregated heuristics for a foreign key relationship.
    Created by aggregating multiple DeepPropertyMatch objects.
    
    Storage Strategy:
    - Redis stores raw counts/sums for incremental updates
    - This model calculates derived metrics (averages) on fetch
    - property_match_patterns is the source of truth for match type distribution
    """

    # Core Identity - What relationship is this?
    entity_a_type: Annotated[str, WithJsonSchema({'prompt_exposed': "true"})] = Field(
        description="Source entity type (e.g., 'User')"
    )
    entity_b_type: Annotated[str, WithJsonSchema({'prompt_exposed': "true"})] = Field(
        description="Target entity type (e.g., 'Account')"
    )
    property_mappings: Annotated[List[PropertyMappingStructure], WithJsonSchema({'prompt_exposed': "true"})] = Field(
        description="Property mappings that define this relationship structure (which properties connect). Example: [{'entity_a_property': 'user_id', 'entity_b_idkey_property': 'id'}]"
    )

    # Aggregated Statistics - How strong is the signal?
    total_matches: Annotated[int, WithJsonSchema({'prompt_exposed': "true"})] = Field(
        default=0,
        description="Number of entity pair instances found with this relationship pattern"
    )
    example_matches: Annotated[List[ExampleEntityMatch], WithJsonSchema({'prompt_exposed': "true"})] = Field(
        default_factory=list,
        description="Sample entity pairs that matched this pattern (max 10 examples)"
    )
    
    # Quality Metrics - How reliable is this relationship?
    property_match_patterns: Annotated[dict[str, dict[str, int]], WithJsonSchema({'prompt_exposed': "true"})] = Field(
        default_factory=dict,
        description="Per-property match type distribution showing data quality. Key: 'entity_a_prop->entity_b_prop', Value: {match_type: count}. Example: {'user_id->id': {'exact': 45, 'prefix': 5}}"
    )
    property_match_quality: Annotated[dict[str, dict[str, float]], WithJsonSchema({'prompt_exposed': "true"})] = Field(
        default_factory=dict,
        description="Per-property per-match-type quality averages. Key: 'entity_a_prop->entity_b_prop', Value: {match_type: avg_quality}. Example: {'user_id->id': {'exact': 1.0, 'prefix': 0.76}}"
    )
    value_match_quality_avg: Annotated[float, WithJsonSchema({'prompt_exposed': "true"})] = Field(
        default=0.0,
        description="Average quality of value matches (0.0-1.0). Higher = more exact matches."
    )
    deep_match_quality_avg: Annotated[float, WithJsonSchema({'prompt_exposed': "true"})] = Field(
        default=0.0,
        description="Average deep match quality score considering BM25, value quality, uniqueness, and simplicity (0.0+). Higher = stronger relationship signal."
    )
    
    # Internal Fields - For incremental updates and processing
    value_match_quality_sum: float = Field(
        default=0.0,
        description="[Internal] Running sum of value match quality for calculating average"
    )
    deep_match_quality_sum: float = Field(
        default=0.0,
        description="[Internal] Running sum of deep match quality for calculating average"
    )
    last_processed: int = Field(
        default=0,
        description="[Internal] Timestamp of last heuristic update"
    )
    
    def get_main_property_mapping(self) -> PropertyMappingStructure | None:
        """
        Get the main/triggering property mapping structure (first one in the list).
        Returns None if no mappings exist.
        """
        return self.property_mappings[0] if self.property_mappings else None
    
    def get_property_quality(self, entity_a_prop: str, entity_b_prop: str) -> float:
        """
        Get the overall average quality for a specific property pair across all match types.
        
        Args:
            entity_a_prop: Property name from entity A
            entity_b_prop: Property name from entity B
            
        Returns:
            Average quality (0.0-1.0) across all match types for this property pair
        """
        prop_pair = f"{entity_a_prop}->{entity_b_prop}"
        
        if prop_pair not in self.property_match_quality:
            return 0.0
        
        qualities = self.property_match_quality[prop_pair]
        patterns = self.property_match_patterns.get(prop_pair, {})
        
        if not qualities or not patterns:
            return 0.0
        
        # Weighted average based on match counts
        total_count = sum(patterns.values())
        weighted_sum = sum(
            patterns.get(match_type, 0) * quality 
            for match_type, quality in qualities.items()
        )
        
        return weighted_sum / total_count if total_count > 0 else 0.0
    
    def get_global_match_type_counts(self) -> dict[str, int]:
        """
        Derive global match type counts from property_match_patterns.
        Useful for getting an overall view of match quality across all properties.
        
        Returns:
            Dictionary with match type as key and total count as value
            Example: {"exact": 50, "prefix": 10, "suffix": 2}
        """
        global_counts: dict[str, int] = {}
        for prop_patterns in self.property_match_patterns.values():
            for match_type, count in prop_patterns.items():
                global_counts[match_type] = global_counts.get(match_type, 0) + count
        return global_counts
    
    def get_composite_idkey_properties(self) -> frozenset[str]:
        """
        Get the set of entity_b properties that form the composite identity key.
        
        Returns:
            Frozenset of property names from entity_b
        """
        return frozenset(pm.entity_b_idkey_property for pm in self.property_mappings)

class FkeyEvaluationResult(str, Enum):
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    UNSURE = "UNSURE"

class FkeyDirectionality(str, Enum):
    FROM_A_TO_B = "FROM_A_TO_B"
    FROM_B_TO_A = "FROM_B_TO_A"

class FkeyEvaluation(BaseModel):
    """
    Represents the evaluation of a foreign key heuristic.
    This is the human/AI decision about whether to accept the relationship.
    
    The evaluation specifies exactly HOW the relationship should be applied,
    including which properties to match and what matching STRATEGY to use for each.
    Quality is observed from data, not specified in the evaluation.
    """
    relation_name: str = Field(description="The name of the relation, e.g. 'HAS', 'IS_A', 'BELONGS_TO', etc.")
    result: FkeyEvaluationResult = Field(default=FkeyEvaluationResult.UNSURE, description="The state of the evaluation, e.g. 'ACCEPTED', 'REJECTED', 'UNSURE', etc.")
    directionality: FkeyDirectionality = Field(default=FkeyDirectionality.FROM_A_TO_B, description="The directionality of the relation, e.g. 'FROM_A_TO_B', 'FROM_B_TO_A', etc.")
    property_mappings: List[PropertyMappingRule] = Field(
        description="The property mapping rules to use when applying this relationship. Specifies which properties to match and what matching strategy (match_type) to use."
    )
    justification: Optional[str] = Field(default="", description="Justification for the relation and the confidence")
    thought: str = Field(default="", description="The agent's thoughts about the relation")
    last_evaluated: int = Field(default=0, description="The last time this heuristic was evaluated, used to determine freshness")
    is_manual: bool = Field(default=False, description="Whether this evaluation was done manually by a human")
    is_sub_entity_relation: bool = Field(default=False, description="Whether this relation is a auto-generated sub-entity relation")

class RelationCandidate(BaseModel):
    """
    Represents a candidate for a relation
    This is used to store the relation information and the heuristic used to identify it
    """
    relation_id: str = Field(description="The unique identifier for the relation, usually a hash of the relation properties")
    heuristic: FkeyHeuristic = Field(description="The heuristic and metrics used to identify the relation")
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


# ============================================================================
# Models for agent evaluation (queue-based group processing)
# ============================================================================

class EntityExample(BaseModel):
    """
    Represents an entity instance with its properties and sub-entities.
    Used for providing context to the agent during evaluation.
    """
    entity_type: str = Field(description="The type of the entity")
    primary_key: str = Field(description="The primary key value of the entity")
    properties: dict[str, Any] = Field(
        default_factory=dict,
        description="Properties of the entity (filtered to only include mapped properties for examples)"
    )
    sub_entities: List['EntityExample'] = Field(
        default_factory=list,
        description="Sub-entities of this entity (recursive, max depth 10)"
    )


class RelationCandidateGroup(BaseModel):
    """
    Group of relation candidates between the same two entity types.
    Used for queue-based evaluation where agents process groups instead of individual candidates.
    """
    entity_a_type: str = Field(description="Source entity type")
    entity_b_type: str = Field(description="Target entity type")
    candidates: List[RelationCandidate] = Field(
        description="List of relation candidates between these two entity types"
    )
    existing_relations: List[str] = Field(
        default_factory=list,
        description="Names of relations already accepted between these two entity types"
    )


class CandidateGroupData(BaseModel):
    """
    Complete data package for agent evaluation of a candidate group.
    Includes the group, pre-loaded examples with sub-entities, and context about why we're evaluating.
    """
    group: RelationCandidateGroup = Field(description="The candidate group to evaluate")
    examples: List[tuple[EntityExample, EntityExample]] = Field(
        default_factory=list,
        description="Up to 3 example entity pairs showing the relationship (with sub-entities loaded)"
    )
    heuristic_change_reason: str = Field(
        default="",
        description="Explanation of why this group is being re-evaluated (e.g., 'count increased by 25%')"
    )


