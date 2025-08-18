import os
from core import utils as utils
from core.graph_db.base import GraphDB
from core.models import AgentOutputFKeyRelation, RelationCandidate

from langchain_core.prompts import PromptTemplate
from langgraph.graph.graph import CompiledGraph
from langchain_core.messages import HumanMessage, AIMessage

from agent_graph_gen.relation_manager import RelationCandidateManager
from agent_graph_gen.prompts import RELATION_PROMPT


class FkeyEvaluator:
    def __init__(self, agent: CompiledGraph, 
                 graphdb: GraphDB, 
                 rc_manager: RelationCandidateManager, 
                 acceptance_threshold: float, 
                 agent_recursion_limit: int = 5):
        self.agent = agent
        self.debug = os.getenv("DEBUG_AGENT", "false").lower() in ("true", "1", "yes")
        self.graphdb = graphdb
        self.acceptance_threshold = acceptance_threshold
        self.agent_recursion_limit = agent_recursion_limit
        self.rc_manager = rc_manager

    async def evaluate(self, candidate: RelationCandidate):
        """
        Agentic evaluation of heuristic.
        """
        logger = utils.get_logger(f"fkey_evaluator[{hash(candidate.relation_id)}]")
        logger.info(f"Evaluating relation candidate {candidate.relation_id}")
        # TODO: Move to long term memory for the LLM
        # if manually_rejected_relations is None:
        #     all_heuristics = await self.fetch_all_heuristics()
        #     manually_rejected_relations =  [rel_id for rel_id, heuristic in all_heuristics.items() if heuristic.state == FKeyHeuristicState.REJECTED and heuristic.manually_intervened]

        # if manually_accepted_relations is None:
        #     all_heuristics = await self.fetch_all_heuristics()
        #     manually_accepted_relations =  [rel_id for rel_id, heuristic in all_heuristics.items() if heuristic.state == FKeyHeuristicState.ACCEPTED and heuristic.manually_intervened]

        if candidate.heuristic.count < 2:
            # If the count is less than 2, we cannot evaluate the relation
            logger.warning(f"Relation candidate {candidate.relation_id} has count {candidate.heuristic.count}, which is less than 2, skipping evaluation.")
            return

        entity_a_with_property_count = await self.graphdb.get_property_value_count(candidate.heuristic.entity_a_type, candidate.heuristic.entity_a_property)

        matching_properties = {}
        for prop in candidate.heuristic.property_mappings:
            matching_properties[prop.entity_a_property] = prop.entity_b_idkey_property
        logger.debug(f"Matching properties: {matching_properties}")
        values = await self.graphdb.get_values_of_matching_property(
            candidate.heuristic.entity_a_type, 
            candidate.heuristic.entity_a_property, 
            candidate.heuristic.entity_b_type, 
            matching_properties, 
            max_results=5)

        entity_types = await self.graphdb.get_all_entity_types()
        entity_types = set(entity_types)
        entity_types.discard(candidate.heuristic.entity_a_type)
        entity_types.discard(candidate.heuristic.entity_b_type)

        entity_a_with_property_percentage=round(100 * candidate.heuristic.count / entity_a_with_property_count, 2) if entity_a_with_property_count > 0 else 0
        
        all_candidates =  await self.rc_manager.fetch_all_candidates()
        entity_a_relation_candidates = []
        for _, rel_candidate in all_candidates.items():
            eval_confidence = str(rel_candidate.evaluation.relation_confidence) if rel_candidate.evaluation is not None else "Not evaluated"
            if rel_candidate.heuristic.entity_a_type == candidate.heuristic.entity_a_type and rel_candidate.heuristic.entity_b_type == candidate.heuristic.entity_b_type:
                candidate_str = f"{rel_candidate.heuristic.entity_a_type}.{rel_candidate.heuristic.entity_a_property} -> {rel_candidate.heuristic.entity_b_type}"
                candidate_str += f"(count: {rel_candidate.heuristic.count}, confidence (if already evaluated): {eval_confidence})"
                entity_a_relation_candidates.append(candidate_str)

        logger.info("Evaluating with agent")
        prompt_tpl = PromptTemplate.from_template(RELATION_PROMPT)
        prompt = prompt_tpl.format(
            entity_a=candidate.heuristic.entity_a_type,
            entity_a_property=candidate.heuristic.entity_a_property,
            entity_b=candidate.heuristic.entity_b_type,
            count=candidate.heuristic.count,
            values=values, 
            entity_a_with_property_count=entity_a_with_property_count,
            entity_a_with_property_percentage=entity_a_with_property_percentage,
            example_matches=utils.json_encode(candidate.heuristic.example_matches, indent=2),
            entity_a_relation_candidates=utils.json_encode(entity_a_relation_candidates, indent=2),
        )

        logger.info(prompt)
        if not self.debug:
            # Invoke the agent with the prompt
            resp = await self.agent.ainvoke(
                {"messages": [
                    HumanMessage(
                        content=prompt
                    )
                ]},
                {"recursion_limit": self.agent_recursion_limit}
            )
            
            ai_thought = ""
            for msg in resp["messages"]:
                if isinstance(msg, AIMessage):
                    ai_thought += "\n" + str(msg.content)
            fkey_agent_response_raw = resp["structured_response"].model_dump_json()
            fkey_agent_response: AgentOutputFKeyRelation = AgentOutputFKeyRelation.model_validate_json(fkey_agent_response_raw)

            logger.info(f"Agent response: {fkey_agent_response_raw}")
        else:
            # For debugging purposes, we can use a static response instead to save time and cost
            fkey_agent_response = AgentOutputFKeyRelation(
                relation_name="HAS",
                relation_confidence=0.5,
                justification="The properties match and the count is not high enough.",
            )
            ai_thought = "This is a debug response, not from the agent."


        if fkey_agent_response.relation_confidence is None: # Assume rejection if no confidence is given
            fkey_agent_response.relation_confidence = 0.0

        # # Check if the confidence is high enough
        # if float(fkey_agent_response.relation_confidence) > float(self.acceptance_threshold):
        #     # Determine what other properties are in the composite key
        #     # If the relation is a composite key, we need to set the additional property mappings
        #     # TODO: Give this to the agent to decide in the future
        #     if candidate.heuristic.is_entity_b_idkey_composite:
        #         # If the relation is a composite key, we need to set the additional property mappings
        #         # Check if there are composite key mappings, which have the same count as the heuristic count
        #         property_mappings = [mapping for mapping in candidate.heuristic.composite_idkey_mappings if mapping.count == candidate.heuristic.count]
                
        #         # Now search for the composite key mappings that match the remaining entity_b's composite key
        #         properties_in_composite_idkey = set(candidate.heuristic.properties_in_composite_idkey)
        #         properties_in_composite_idkey.remove(candidate.heuristic.entity_b_idkey_property)
        #         for prop_in_idkey in properties_in_composite_idkey:
        #             matched_mapping = next(iter([mapping for mapping in property_mappings if mapping.entity_b_idkey_property == prop_in_idkey]), None)
        #             if matched_mapping is None:
        #                 # If there is no mapping for the property, we cannot accept the relation
        #                 error_message = f"No appropriate mapping found for property {prop_in_idkey} in composite key, cannot accept relation."
        #                 logger.error(error_message)
        #                 await self.rc_manager.update_evaluation_error(candidate.relation_id, error_message)
        #                 return  # Update the evaluation error message and return, as we cannot accept the relation
        #             else:
        #                 # Set this additional property has accepted for the relation
        #                 matched_mapping.is_accepted = True

        await self.rc_manager.update_evaluation(
            relation_id=candidate.relation_id,
            relation_name=fkey_agent_response.relation_name.replace(" ", "_").upper(),
            relation_confidence=float(fkey_agent_response.relation_confidence), 
            justification=str(fkey_agent_response.justification), 
            thought=ai_thought,
            values=values,
            entity_a_with_property_count=entity_a_with_property_count,
            entity_a_with_property_percentage=entity_a_with_property_percentage,
            evaluation_count=candidate.heuristic.count
        )