import os
import traceback

from core.graph_db.base import GraphDB
from core.key_value.base import KVStore
from langgraph.prebuilt import create_react_agent

from core.agent.tools import fetch_entity
from agent_graph_gen.heuristics import HeuristicsProcessor
from agent_graph_gen.relation_manager import RelationCandidateManager
from agent_graph_gen.prompts import RELATION_PROMPT, SYSTEM_PROMPT_1
from core.models import AgentOutputFKeyRelation, RelationCandidate
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.prompts import PromptTemplate
from langgraph.graph.graph import CompiledGraph

import core.utils as utils
from core import constants
import agent_graph_gen.helpers as helpers
from cnoe_agent_utils import LLMFactory

AGENT_NAME = "OntologyAgent"

AGENT_TOOLS =[fetch_entity]

class OntologyAgent:
    """
    This class contains functions for evaluating and processing heuristics as well as the code that
     agent follows to determine relations.
    """

    def __init__(self, graph_db: GraphDB, ontology_graph_db: GraphDB, kv_store : KVStore, acceptance_threshold: float, rejection_threshold: float, 
        min_count_for_eval: int, percent_change_for_eval: float, max_concurrent_processing: int, max_concurrent_evaluation: int, agent_recursion_limit: int = 5):
        """
        Initializes the OntologyAgent with the given parameters.
        Args:
            graph_db (GraphDB): The graph database to use.
            ontology_graph_db (GraphDB): The ontology graph database to use.
            acceptance_threshold (float): The confidence threshold for accepting a relation.
            rejection_threshold (float): The confidence threshold for rejecting a relation.
            min_count_for_eval (int): The minimum count of matches to consider the heuristic for evaluation.
            percent_change_for_eval (float): The percentage change in count needed to trigger re-evaluation.
            max_concurrent_processing (int): The maximum number of concurrent processing tasks.
            max_concurrent_evaluation (int): The maximum number of concurrent evaluation tasks.
            agent_recursion_limit (int): The maximum number of recursive calls to the agent.
        """
        self.kv_store = kv_store
        self.graph_db = graph_db
        self.ontology_graph_db = ontology_graph_db
        self.logger = utils.get_logger("ontology_agent")
        self.is_processing = False # Avoid parallel processing/evaluation
        self.acceptance_threshold = acceptance_threshold
        self.rejection_threshold = rejection_threshold
        self.min_count_for_eval = min_count_for_eval
        self.percent_change_for_eval = percent_change_for_eval
        self.max_concurrent_processing = max_concurrent_processing
        self.max_concurrent_evaluation = max_concurrent_evaluation
        self.agent_recursion_limit = agent_recursion_limit

        self.debug = os.getenv("DEBUG_AGENT", "false").lower() in ("true", "1", "yes")
        self.agent = self.create_agent()

    async def sync_all_relations(self, rc_manager: RelationCandidateManager):
        """
        Syncs all accepted relations with the graph database.
        """
        self.logger.info("Syncing all relations with the graph database...")
        candidates = await rc_manager.fetch_all_candidates()
        for _, candidate in candidates.items():
            await rc_manager.sync_relation(AGENT_NAME, candidate.relation_id)
            # TODO: Gather relations that are no longer candidates, but still exist in the graph database, and remove them

    async def process_and_evaluate_all(self):
        self.logger.info("Running heuristics processing and the evaluation...")
        
        # create a new heuristics version
        new_heuristics_version_id = utils.get_uuid()
        self.logger.info(f"Created new heuristics version: {new_heuristics_version_id}")

        # use the new heuristics version for processing and evaluation
        rc_manager_new_version = RelationCandidateManager(self.graph_db, self.ontology_graph_db, self.acceptance_threshold, self.rejection_threshold, new_heuristics_version_id)

        await self.process_all(rc_manager_new_version)
        if new_heuristics_version_id is None:
            self.logger.warning("Heuristics processing failed, skipping evaluation")
            return

        # Evaluate the new heuristics version
        await self.evaluate_all(rc_manager_new_version)

        # set the new heuristics version as the current heuristics version
        self.logger.info(f"Setting new heuristics version: {new_heuristics_version_id}")
        await self.kv_store.put(constants.KV_HEURISTICS_VERSION_ID_KEY, new_heuristics_version_id)

        await rc_manager_new_version.cleanup()
        await self.sync_all_relations(rc_manager_new_version) # sync all relations with the graph database, just in case some relations were not updated

    async def process_all(self, rc_manager: RelationCandidateManager) -> str|None:
        """
        Processes all entities in the database to compute heuristics.
        This is meant to be run periodically to update the heuristics based on the entities in the database.
        """
        self.logger.info("Processing all entities for heuristics")
        if self.is_processing:
            self.logger.warning("Processing is already in progress, skipping this run")
            return None
        
        self.is_processing = True



        heuristics_processor = HeuristicsProcessor(self.graph_db)
        entity_types = await self.graph_db.get_all_entity_types()
        entities = []
        for entity_type in entity_types:
            entities += await self.graph_db.find_entity(entity_type, {}, max_results=10000)
        self.logger.info(f"Processing {len(entities)} entities for heuristics")

        tasks = []
        for entity in entities:
            self.logger.debug(f"Processing entity {entity}")
            tasks.append(heuristics_processor.process(entity, rc_manager))

        self.logger.info(f"{len(tasks)}  entities to be processed, concurrency limit is {self.max_concurrent_processing}")

        await utils.gather(self.max_concurrent_processing, *tasks, logger=self.logger)

        self.is_processing = False
    

    async def evaluate_all(self, rc_manager: RelationCandidateManager):
        """
        Evaluates all relations in the database.
        :param rc_manager: The relation candidate manager to use. 
        This is meant to be run periodically to update the relations based on the heuristics.
        """        
        self.logger.info("Evaluating all relations for heuristics_version_id: %s", rc_manager.heuristics_version_id)
        # Get all relation candidates
        relation_candidates = await rc_manager.fetch_all_candidates()
        self.logger.info(f"Found {len(relation_candidates)} relation candidates to evaluate")
        # Create tasks for each relation candidate
        tasks = []
        index = 0
        for _, candidate in relation_candidates.items():
            tasks.append(self.evaluation_task(index, rc_manager, candidate.relation_id))
            index += 1

        # Run the evaluation tasks concurrently
        await utils.gather(self.max_concurrent_evaluation, *tasks, logger=self.logger)

    async def process(self, rc_manager: RelationCandidateManager, entity_type: str, entity_id: str):
        """
        Processes a single relation candidate. (Used for debugging)
        """
        self.logger.info("Processing entity %s[%s] for heuristics_version_id: %s", entity_type, entity_id, rc_manager.heuristics_version_id)
        heuristics_processor = HeuristicsProcessor(self.graph_db)
        entity = await self.graph_db.find_entity_by_id_value(entity_type, entity_id)
        if entity is None:
            self.logger.error(f"Entity {entity_type}:{entity_id} not found")
            return
        await heuristics_processor.process(entity[0], rc_manager)

    async def evaluation_task(self, task_id, rc_manager: RelationCandidateManager, relation_id, force=False):
        """
        A worker that picks up entities from the queue and computes heuristics.
        """
        logger = utils.get_logger(f"eval-{task_id}")
        logger.info(f"Evaluating relation candidate {relation_id} for heuristics_version_id: {rc_manager.heuristics_version_id}")
        try:
            candidate = await rc_manager.fetch_candidate(relation_id)
            if candidate is None:
                logger.warning(f"Candidate for relation {relation_id} not found, skipping evaluation.")
                return

            if not force and candidate.evaluation is not None:
                if (helpers.is_accepted(candidate.evaluation.relation_confidence, self.acceptance_threshold)):
                    # If the heuristic is already evaluated, we can skip it
                    self.logger.info(f"Skipping evaluation for {candidate.relation_id}, already accepted with confidence {candidate.evaluation.relation_confidence}.")
                    return
                if candidate.evaluation.relation_confidence is not None and (helpers.is_rejected(candidate.evaluation.relation_confidence, self.rejection_threshold)):
                    # If the heuristic is already evaluated, we can skip it
                    self.logger.info(f"Skipping evaluation for {candidate.relation_id}, already rejected with confidence {candidate.evaluation.relation_confidence}.")
                    return
                if candidate.heuristic.count < self.min_count_for_eval:
                    self.logger.info(f"Skipping evaluation for {candidate.relation_id}, count is {candidate.heuristic.count} which is below the minimum count for evaluation.")
                    return
                if candidate.evaluation.last_evaluation_count is None:
                    candidate.evaluation.last_evaluation_count = 0

                # If the heuristic count changed less than 20% than previous count, we ignore it
                if candidate.evaluation.last_evaluation_count > 0:
                    count_distance = abs( - candidate.heuristic.count) / abs(candidate.heuristic.count)
                    if count_distance < self.percent_change_for_eval: # type: ignore
                        self.logger.info(f"Skipping evaluation for {candidate.relation_id}, previous count is less than 20% of current count.")
                        return
            else:
                self.logger.info(f"Evaluating {candidate.relation_id} with count {candidate.heuristic.count}. force={force}, never evaluated={candidate.evaluation is None}")
                c = await rc_manager.fetch_candidate(relation_id)
                if c is None:
                    self.logger.warning(f"Relation candidate {relation_id} not found, skipping evaluation.")
                    return
                await self.evaluate(rc_manager=rc_manager, candidate=c)
                await rc_manager.sync_relation(AGENT_NAME, relation_id)
        except Exception as e:
            self.logger.error(traceback.format_exc())
            self.logger.error(f"Error evaluating relation {relation_id}: {e}")


    def create_agent(self) -> CompiledGraph:
        # Create the agent
        llm = LLMFactory().get_llm()

        heuristic_schema = ""
        for prop, details in RelationCandidate.model_json_schema()["properties"].items():
            if details.get("prompt_exposed", False):
                heuristic_schema += f"{prop}: {details.get('description', '')}\n"

        self.logger.debug(heuristic_schema)

        system_prompt = PromptTemplate.from_template(SYSTEM_PROMPT_1).format(
            heuristic_schema=heuristic_schema,
            database_type=self.graph_db.database_type,
            query_language=self.graph_db.query_language
        )
        agent = create_react_agent(llm, tools=AGENT_TOOLS, prompt=system_prompt,
                                   response_format=("The last message is the evaluation of a relation candidate, using only the evaluation text, generate a structured response. "
                                   "DO NOT use your own knowledge, only use the evaluation text to generate the response.",
                                    AgentOutputFKeyRelation))
        agent.name = AGENT_NAME
        return agent

    async def evaluate(self, rc_manager: RelationCandidateManager, relation_id: str = "", candidate: RelationCandidate|None = None):
        """
        Agentic evaluation of heuristic.

        Args:
            rc_manager (RelationCandidateManager): Relation candidate manager.
            relation_id (str, optional): Relation candidate ID. Defaults to "".
            candidate (RelationCandidate|None, optional): Relation candidate. Defaults to None.
        """
        logger = utils.get_logger(f"fkey_evaluator[{hash(relation_id)}]")
        logger.info(f"Evaluating relation candidate {relation_id} for heuristics_version_id: {rc_manager.heuristics_version_id}")
        if candidate and relation_id != "":
            raise ValueError("Relation and relation_id cannot both be provided")
        
        # Fetch the candidate if relation_id is provided
        if relation_id != "":
            candidate = await rc_manager.fetch_candidate(relation_id)
            if candidate is None:
                logger.error(f"Relation candidate {relation_id} is None, skipping evaluation.")
                return
        
        # If candidate is not provided, we cannot evaluate
        if candidate is None:
            raise ValueError("Relation candidate is None, cannot evaluate")

        # TODO: Move to long term memory for the LLM
        # if manually_rejected_relations is None:
        #     all_heuristics = await self.fetch_all_heuristics()
        #     manually_rejected_relations =  [rel_id for rel_id, heuristic in all_heuristics.items() if heuristic.state == FKeyHeuristicState.REJECTED and heuristic.manually_intervened]

        # if manually_accepted_relations is None:
        #     all_heuristics = await self.fetch_all_heuristics()
        #     manually_accepted_relations =  [rel_id for rel_id, heuristic in all_heuristics.items() if heuristic.state == FKeyHeuristicState.ACCEPTED and heuristic.manually_intervened]

        if candidate.heuristic.count < self.min_count_for_eval:
            # If the count is less than min_count_for_eval, we cannot evaluate the relation
            logger.warning(f"Relation candidate {candidate.relation_id} has count {candidate.heuristic.count}, which is less than {self.min_count_for_eval}, skipping evaluation.")
            return

        property_counts = {}
        property_values = {}

        matching_properties = {}
        for prop in candidate.heuristic.property_mappings:
            matching_properties[prop.entity_a_property] = prop.entity_b_idkey_property
            property_counts[prop.entity_a_property] = await self.graph_db.get_property_value_count(candidate.heuristic.entity_a_type, prop.entity_a_property)
            property_values[prop.entity_a_property] = await self.graph_db.get_values_of_matching_property(
                candidate.heuristic.entity_a_type, 
                prop.entity_a_property,
                candidate.heuristic.entity_b_type, 
                matching_properties, 
                max_results=5)

        entity_types = await self.graph_db.get_all_entity_types()
        entity_types = set(entity_types)
        entity_types.discard(candidate.heuristic.entity_a_type)
        entity_types.discard(candidate.heuristic.entity_b_type)

        all_candidates =  await rc_manager.fetch_all_candidates()
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
            entity_b=candidate.heuristic.entity_b_type,
            property_mappings=utils.json_encode(candidate.heuristic.property_mappings, indent=2),
            count=candidate.heuristic.count,
            values=property_values,
            entity_a_with_property_counts=property_counts,
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

        await rc_manager.update_evaluation(
            relation_id=candidate.relation_id,
            relation_name=fkey_agent_response.relation_name.replace(" ", "_").upper(),
            relation_confidence=float(fkey_agent_response.relation_confidence), 
            justification=str(fkey_agent_response.justification), 
            thought=ai_thought,
            entity_a_property_values=property_values,
            entity_a_property_counts=property_counts,
            evaluation_count=candidate.heuristic.count
        )