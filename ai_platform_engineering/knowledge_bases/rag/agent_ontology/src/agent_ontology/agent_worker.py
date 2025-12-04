"""
Agent Worker Module

This module contains the AgentWorker class which represents an isolated worker instance
for evaluating relation candidate groups. Each worker has its own queue and state,
avoiding shared state issues and race conditions.
"""

import logging
import os
import traceback
import asyncio
from typing import Any

from common.graph_db.base import GraphDB
from common import constants
from langchain_core.tools.structured import StructuredTool
from langgraph.prebuilt import create_react_agent
from langmem.short_term import SummarizationNode
from langchain_core.messages.utils import count_tokens_approximately
from agent_ontology.relation_manager import RelationCandidateManager
from common.models.ontology import (
    FkeyEvaluationResult,
    ValueMatchType,
    PropertyMappingRule,
    CandidateGroupData,
)
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt.chat_agent_executor import AgentState
import common.utils as utils


# Configuration for summarization
max_llm_tokens = int(os.getenv("MAX_LLM_TOKENS", 100000))
max_summary_tokens = int(max_llm_tokens * 0.1)


class AgentWorker:
    """
    Isolated worker instance for evaluating multiple candidate groups.
    Each worker has its own queue of groups and tools, avoiding shared state issues.
    """
    
    def __init__(
        self,
        worker_id: int,
        groups_queue: list[CandidateGroupData],
        rc_manager: RelationCandidateManager,
        data_graph_db: GraphDB,
        agent_recursion_limit: int,
        progress_tracker: dict[str, int] | None = None
    ):
        """
        Initialize an isolated agent worker with its own queue.
        
        Args:
            worker_id: Unique identifier for this worker
            groups_queue: List of candidate group data to evaluate (pre-loaded with examples)
            rc_manager: Relation candidate manager for this ontology version
            data_graph_db: Data graph database reference
            agent_recursion_limit: Max recursion limit for the agent
            progress_tracker: Optional shared dict for tracking progress across workers
                             Expected keys: 'completed_groups', 'total_groups'
        """
        self.worker_id = worker_id
        self.groups_queue = groups_queue  # Worker's own queue
        self.rc_manager = rc_manager
        self.data_graph_db = data_graph_db
        self.agent_recursion_limit = agent_recursion_limit
        self.progress_tracker = progress_tracker
        
        # Create worker-specific logger
        self.evaluation_logger = utils.get_logger(f"evaluation_{worker_id}")
        
        # Current group being evaluated
        self.current_group_data: CandidateGroupData | None = None
        
        # Worker-local state for current group
        self.accepted_count = 0  # Reset for each group
        self.total_evaluation_count = 0  # Total across all groups
        
        # Lock for serializing accept/reject operations
        self._accept_reject_lock = asyncio.Lock()
    
    async def fetch_next_relation_candidate(self, thought: str) -> str:
        """
        Fetches the next relation candidate group from this worker's queue for evaluation.
        This tool should be called to get the next group when ready to evaluate.
        
        Args:
            thought (str): Your thoughts on why you're fetching the next group
            
        Returns:
            str: JSON representation of the CandidateGroupData or message if no more groups
        """
        self.evaluation_logger.info(f"Worker {self.worker_id}: Fetching next relation candidate group, Thought: {thought}")
        
        # Check if there are more groups in this worker's queue
        if not self.groups_queue:
            return "No more candidate groups to evaluate in your queue. All assigned groups have been processed."
        
        # Pop the next group from the worker's queue
        self.current_group_data = self.groups_queue.pop(0)
        
        # Reset accepted count for the new group
        self.accepted_count = 0
        
        # Update progress tracker if available
        if self.progress_tracker is not None:
            self.progress_tracker['completed_groups'] += 1
            completed = self.progress_tracker['completed_groups']
            total = self.progress_tracker['total_groups']
            self.evaluation_logger.info(
                f"Worker {self.worker_id}: Loaded group {self.current_group_data.group.entity_a_type} -> "
                f"{self.current_group_data.group.entity_b_type} "
                f"(Progress: {completed}/{total}, {len(self.groups_queue)} remaining in worker queue)"
            )
        else:
            self.evaluation_logger.info(
                f"Worker {self.worker_id}: Loaded group {self.current_group_data.group.entity_a_type} -> "
                f"{self.current_group_data.group.entity_b_type} "
                f"({len(self.groups_queue)} groups remaining in worker queue)"
            )
        
        # Format the response with all relevant information
        response = {
            "entity_a_type": self.current_group_data.group.entity_a_type,
            "entity_b_type": self.current_group_data.group.entity_b_type,
            "num_candidates": len(self.current_group_data.group.candidates),
            "existing_relations": self.current_group_data.group.existing_relations,
            "reason_for_evaluation": self.current_group_data.heuristic_change_reason,
            "groups_remaining_in_queue": len(self.groups_queue),
            "candidates": [
                {
                    "relation_id": c.relation_id,
                    "property_mappings": [pm.model_dump() for pm in c.heuristic.property_mappings],
                    "total_matches": c.heuristic.total_matches,
                    "value_match_quality_avg": c.heuristic.value_match_quality_avg,
                    "deep_match_quality_avg": c.heuristic.deep_match_quality_avg,
                    "property_match_patterns": c.heuristic.property_match_patterns,
                }
                for c in self.current_group_data.group.candidates
            ],
            "examples": [
                {
                    "entity_a": {
                        "type": ex[0].entity_type,
                        "primary_key": ex[0].primary_key,
                        "properties": ex[0].properties,
                        "sub_entities": [
                            {
                                "type": sub.entity_type,
                                "primary_key": sub.primary_key,
                                "properties": sub.properties
                            }
                            for sub in ex[0].sub_entities
                        ]
                    },
                    "entity_b": {
                        "type": ex[1].entity_type,
                        "primary_key": ex[1].primary_key,
                        "properties": ex[1].properties,
                        "sub_entities": [
                            {
                                "type": sub.entity_type,
                                "primary_key": sub.primary_key,
                                "properties": sub.properties
                            }
                            for sub in ex[1].sub_entities
                        ]
                    }
                }
                for ex in self.current_group_data.examples
            ]
        }
        
        return utils.json_encode(response, indent=2)
    
    async def fetch_entity(self, entity_type: str, primary_key_id: str, thought: str) -> str:
        """
        Fetches a single entity and returns all its properties from the graph database.
        
        Args:
            entity_type (str): The type of entity
            primary_key_id (str): The primary key id of the entity
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: The properties of the entity
        """
        self.evaluation_logger.info(f"Worker {self.worker_id}: Fetching entity of type {entity_type} with primary_key_id {primary_key_id}, Thought: {thought}")
        
        if self.data_graph_db is None:
            self.evaluation_logger.error("Graph database is not available")
            return "Error: graph database is not available."
        
        try:
            entity = await self.data_graph_db.fetch_entity(entity_type, primary_key_id)
            if entity is None:
                return f"no entity of type {entity_type} with primary_key_id {primary_key_id}"
            return utils.json_encode(entity.get_external_properties())
        except Exception as e:
            self.evaluation_logger.error(f"Traceback: {traceback.format_exc()}")
            self.evaluation_logger.error(f"Error fetching entity {entity_type} with primary_key_id {primary_key_id}: {e}")
            return f"Error fetching entity {entity_type} with primary_key_id {primary_key_id}: {e}"
    
    async def query_existing_relations(self, entity_a_type: str, entity_b_type: str, thought: str) -> str:
        """
        Query existing accepted relations between two entity types.
        
        Args:
            entity_a_type (str): Source entity type
            entity_b_type (str): Target entity type
            thought (str): Your thoughts on why you're querying
            
        Returns:
            str: JSON list of existing relation names
        """
        self.evaluation_logger.info(f"Worker {self.worker_id}: Querying existing relations between {entity_a_type} and {entity_b_type}, Thought: {thought}")
        
        try:
            # Query ontology DB for accepted relations between these types
            relations = await self.rc_manager.ontology_graph_db.find_relations(
                from_entity_type=entity_a_type,
                to_entity_type=entity_b_type,
                properties={constants.ONTOLOGY_VERSION_ID_KEY: self.rc_manager.ontology_version_id}
            )
            
            relation_names = []
            for rel in relations:
                if rel.relation_properties and rel.relation_properties.get("eval_result") == FkeyEvaluationResult.ACCEPTED.value:
                    rel_name = rel.relation_properties.get("eval_relation_name")
                    if rel_name and rel_name != constants.CANDIDATE_RELATION_NAME:
                        relation_names.append(rel_name)
            
            return utils.json_encode({"existing_relations": list(set(relation_names))})
        except Exception as e:
            self.evaluation_logger.error(f"Error querying existing relations: {e}")
            return f"Error querying existing relations: {e}"
    
    async def accept_relation(self, relation_id: str, relation_name: str, justification: str, property_mappings: list[PropertyMappingRule]) -> str:
        """
        Accepts a relation candidate by updating its evaluation to ACCEPTED.
        
        Args:
            relation_id (str): The ID of the relation to accept
            relation_name (str): The name of the relation
            justification (str): Justification for accepting the relation
            property_mappings (list[PropertyMappingRule]): List of property mapping rules with match types

        Returns:
            str: Success or error message
        """
        self.evaluation_logger.debug(f"Worker {self.worker_id}: Accepting relation {relation_id} with name '{relation_name}'")
        
        async with self._accept_reject_lock:
            try:
                if relation_name.strip() == "":
                    return "Error: Relation name cannot be empty when accepting a relation. Please provide a valid relation name."
                
                if self.current_group_data is None:
                    return "Error: No group has been fetched yet. Please call fetch_next_relation_candidate first."
                
                # Find the candidate in the current group
                candidate = None
                for c in self.current_group_data.group.candidates:
                    if c.relation_id == relation_id:
                        candidate = c
                        break
                
                if candidate is None:
                    self.evaluation_logger.error(
                        f"Worker {self.worker_id}: Relation {relation_id} does NOT belong to current group "
                        f"({self.current_group_data.group.entity_a_type} -> {self.current_group_data.group.entity_b_type})"
                    )
                    return (
                        f"Error: Relation {relation_id} does not belong to the current group "
                        f"({self.current_group_data.group.entity_a_type} -> {self.current_group_data.group.entity_b_type}). "
                        f"You can only accept relations from the group you most recently fetched."
                    )
                
                # Validate: Property mappings must match the candidate's heuristic structure
                heuristic_mappings = {
                    (pm.entity_a_property, pm.entity_b_idkey_property) 
                    for pm in candidate.heuristic.property_mappings
                }
                provided_mappings = {
                    (pm.entity_a_property, pm.entity_b_idkey_property) 
                    for pm in property_mappings
                }
                
                if heuristic_mappings != provided_mappings:
                    missing = heuristic_mappings - provided_mappings
                    extra = provided_mappings - heuristic_mappings
                    error_msg = f"Error: Property mappings do not match candidate's heuristic structure."
                    if missing:
                        error_msg += f"\nMissing mappings: {missing}"
                    if extra:
                        error_msg += f"\nExtra mappings: {extra}"
                    error_msg += f"\nExpected mappings from heuristic: {heuristic_mappings}"
                    self.evaluation_logger.error(f"Worker {self.worker_id}: {error_msg}")
                    return error_msg
                
                self.evaluation_logger.debug(
                    f"Worker {self.worker_id}: Group ({self.current_group_data.group.entity_a_type} -> "
                    f"{self.current_group_data.group.entity_b_type}) has {self.accepted_count} accepted relation(s) so far. "
                    f"Attempting to accept {relation_id} with name '{relation_name}'"
                )
                
                # Warn if accepting multiple relations in same group
                if self.accepted_count >= 1:
                    self.evaluation_logger.warning(
                        f"Worker {self.worker_id}: Trying to accept multiple relations in group "
                        f"({self.current_group_data.group.entity_a_type} -> {self.current_group_data.group.entity_b_type}). "
                        f"Already has {self.accepted_count} accepted relation(s). Relation: {relation_id}, Name: {relation_name}"
                    )
                    if "multiple" not in justification.lower() and "several" not in justification.lower():
                        return (
                            f"Warning: This group already has {self.accepted_count} accepted relation(s). "
                            f"You should typically only accept ONE relation between entity types unless there's very strong "
                            f"evidence for multiple relations. If you're certain, include 'multiple' or 'several' in your justification."
                        )

                await self.rc_manager.update_evaluation(
                    relation_id=relation_id,
                    relation_name=relation_name.replace(" ", "_").upper(),
                    result=FkeyEvaluationResult.ACCEPTED,
                    justification=justification,
                    thought="",  # Thought is captured from agent messages
                    is_manual=True,
                    property_mappings=property_mappings  # Already PropertyMappingRule objects
                )
                
                self.accepted_count += 1
                self.total_evaluation_count += 1
                
                self.evaluation_logger.debug(
                    f"Worker {self.worker_id}: Accepted relation {relation_id}. "
                    f"Total accepted in this group: {self.accepted_count}"
                )
                self.evaluation_logger.info(f"Worker {self.worker_id}: Successfully accepted relation {relation_id}")
                
                return f"Successfully accepted relation {relation_id} with name '{relation_name}'"
            except Exception as e:
                self.evaluation_logger.error(traceback.format_exc())
                self.evaluation_logger.error(f"Worker {self.worker_id}: Error accepting relation {relation_id}: {e}")
                return f"Error accepting relation {relation_id}: {e}"
    
    async def reject_relation(self, relation_id: str, justification: str, thought: str) -> str:
        """
        Rejects a relation candidate by updating its evaluation to REJECTED.
        
        Args:
            relation_id (str): The ID of the relation to reject
            justification (str): Justification for rejecting the relation
            thought (str): Agent's thought process
            
        Returns:
            str: Success or error message
        """
        self.evaluation_logger.debug(f"Worker {self.worker_id}: Rejecting relation {relation_id}, Justification: {justification}")
        
        async with self._accept_reject_lock:
            try:
                # Get the heuristic
                heuristic = await self.rc_manager.fetch_heuristic(relation_id)
                if heuristic is None:
                    return "Error: Relation heuristic not found"

                # Convert property mappings to PropertyMappingRule objects with NONE match type
                property_mapping_rules = [
                    PropertyMappingRule(
                        entity_a_property=pm.entity_a_property,
                        entity_b_idkey_property=pm.entity_b_idkey_property,
                        match_type=ValueMatchType.NONE
                    )
                    for pm in heuristic.property_mappings
                ]

                await self.rc_manager.update_evaluation(
                    relation_id=relation_id,
                    relation_name=constants.CANDIDATE_RELATION_NAME,
                    result=FkeyEvaluationResult.REJECTED,
                    justification=justification,
                    thought=thought,
                    is_manual=True,
                    property_mappings=property_mapping_rules
                )
                
                self.total_evaluation_count += 1
                
                self.evaluation_logger.info(f"Worker {self.worker_id}: Successfully rejected relation {relation_id}")
                return f"Successfully rejected relation {relation_id}'"
            except Exception as e:
                self.evaluation_logger.error(traceback.format_exc())
                self.evaluation_logger.error(f"Worker {self.worker_id}: Error rejecting relation {relation_id}: {e}")
                return f"Error rejecting relation {relation_id}: {e}"
    
    async def mark_relation_unsure(self, relation_id: str, justification: str) -> str:
        """
        Marks a relation candidate as UNSURE.
        Use this when you cannot confidently accept or reject a relation.
        
        Args:
            relation_id (str): The ID of the relation to mark as unsure
            justification (str): Justification for being unsure about the relation
            
        Returns:
            str: Success or error message
        """
        self.evaluation_logger.debug(f"Worker {self.worker_id}: Marking relation {relation_id} as UNSURE, Justification: {justification}")
        
        async with self._accept_reject_lock:
            try:
                # Get the heuristic
                heuristic = await self.rc_manager.fetch_heuristic(relation_id)
                if heuristic is None:
                    return "Error: Relation heuristic not found"

                # Convert property mappings to PropertyMappingRule objects with EXACT match type (default)
                property_mapping_rules = [
                    PropertyMappingRule(
                        entity_a_property=pm.entity_a_property,
                        entity_b_idkey_property=pm.entity_b_idkey_property,
                        match_type=ValueMatchType.EXACT
                    )
                    for pm in heuristic.property_mappings
                ]

                await self.rc_manager.update_evaluation(
                    relation_id=relation_id,
                    relation_name=constants.CANDIDATE_RELATION_NAME,
                    result=FkeyEvaluationResult.UNSURE,
                    justification=justification,
                    thought="",  # Thought captured from agent messages
                    is_manual=True,
                    property_mappings=property_mapping_rules
                )
                
                self.total_evaluation_count += 1
                
                self.evaluation_logger.info(f"Worker {self.worker_id}: Successfully marked relation {relation_id} as UNSURE")
                return f"Successfully marked relation {relation_id} as UNSURE"
            except Exception as e:
                self.evaluation_logger.error(traceback.format_exc())
                self.evaluation_logger.error(f"Worker {self.worker_id}: Error marking relation {relation_id} as unsure: {e}")
                return f"Error marking relation {relation_id} as unsure: {e}"
    
    def create_agent(self, entity_types: list[str], system_prompt: str, base_llm) -> CompiledStateGraph:
        """
        Create an agent with tools bound to this worker instance.
        
        Args:
            entity_types: List of entity types in the system
            system_prompt: System prompt for the agent
            base_llm: Base LLM to use
            
        Returns:
            Compiled agent graph
        """
        # Create tools bound to THIS worker instance
        tools = [
            StructuredTool.from_function(coroutine=self.fetch_next_relation_candidate),
            StructuredTool.from_function(coroutine=self.fetch_entity),
            StructuredTool.from_function(coroutine=self.accept_relation),
            StructuredTool.from_function(coroutine=self.reject_relation),
            StructuredTool.from_function(coroutine=self.mark_relation_unsure),
            StructuredTool.from_function(coroutine=self.query_existing_relations),
        ]
        
        # Define custom state schema with context for summarization tracking
        class State(AgentState):
            context: dict[str, Any]
        
        agent = create_react_agent(
            base_llm, 
            tools=tools, 
            prompt=system_prompt,
            state_schema=State,
            pre_model_hook=SummarizationNode(
                token_counter=count_tokens_approximately,
                model=base_llm,
                max_tokens=max_llm_tokens,
                max_summary_tokens=max_summary_tokens,
                output_messages_key="llm_input_messages"
            )
        )
        agent.name = f"OntologyAgent_Worker_{self.worker_id}"
        return agent

