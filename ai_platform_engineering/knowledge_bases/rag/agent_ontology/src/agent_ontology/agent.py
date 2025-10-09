import os
import traceback

from common.graph_db.base import GraphDB
from langgraph.prebuilt import create_react_agent
from common.agent.tools import fetch_entity
from agent_ontology.heuristics import HeuristicsProcessor
from agent_ontology.relation_manager import RelationCandidateManager
from agent_ontology.prompts import RELATION_PROMPT, SYSTEM_PROMPT_1
from common.models.ontology    import AgentOutputFKeyRelation, RelationCandidate
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.prompts import PromptTemplate
from langgraph.graph.state import CompiledStateGraph

import redis.asyncio as redis
import common.utils as utils
from common import constants
import agent_ontology.helpers as helpers
from cnoe_agent_utils import LLMFactory

AGENT_NAME = "OntologyAgent"

AGENT_TOOLS =[fetch_entity]

class OntologyAgent:
    """
    This class contains functions for evaluating and processing heuristics as well as the code that
     agent follows to determine relations.
    """

    def __init__(self, graph_db: GraphDB, ontology_graph_db: GraphDB, redis : redis.Redis, acceptance_threshold: float, rejection_threshold: float, 
        min_count_for_eval: int, count_change_threshold_ratio: float, max_concurrent_processing: int, max_concurrent_evaluation: int, agent_recursion_limit: int = 5):
        """
        Initializes the OntologyAgent with the given parameters.
        Args:
            graph_db (GraphDB): The graph database to use.
            ontology_graph_db (GraphDB): The ontology graph database to use.
            acceptance_threshold (float): The confidence threshold for accepting a relation.
            rejection_threshold (float): The confidence threshold for rejecting a relation.
            min_count_for_eval (int): The minimum count of matches to consider the heuristic for evaluation.
            count_change_threshold_ratio (float): The ratio of count change needed to trigger re-evaluation (0.0-1.0, e.g., 0.1 = 10% change).
            max_concurrent_processing (int): The maximum number of concurrent processing tasks.
            max_concurrent_evaluation (int): The maximum number of concurrent evaluation tasks.
            agent_recursion_limit (int): The maximum number of recursive calls to the agent.
        """
        self.redis = redis
        self.graph_db = graph_db
        self.ontology_graph_db = ontology_graph_db
        self.logger = utils.get_logger("ontology_agent")
        self.acceptance_threshold = acceptance_threshold
        self.rejection_threshold = rejection_threshold
        self.min_count_for_eval = min_count_for_eval
        self.count_change_threshold_ratio = count_change_threshold_ratio
        self.max_concurrent_processing = max_concurrent_processing
        self.max_concurrent_evaluation = max_concurrent_evaluation
        self.agent_recursion_limit = agent_recursion_limit

        # status flags
        self.is_processing = False # Avoid parallel processing/evaluation
        self.is_evaluating = False
        self.processing_tasks_total = 0
        self.processed_tasks_count = 0
        self.evaluation_tasks_total = 0
        self.evaluated_tasks_count = 0

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

        # fetch the current heuristics version
        current_heuristics_version_id = await self.redis.get(constants.KV_HEURISTICS_VERSION_ID_KEY)
        current_heuristics_version_id = current_heuristics_version_id.decode('utf-8') if current_heuristics_version_id else None
        rc_manager_current_version = None
        if current_heuristics_version_id:
            rc_manager_current_version = RelationCandidateManager(self.graph_db, self.ontology_graph_db, self.acceptance_threshold, self.rejection_threshold, current_heuristics_version_id)

        await self.process_all(rc_manager_new_version)
        if new_heuristics_version_id is None:
            self.logger.warning("Heuristics processing failed, skipping evaluation")
            return

        # Evaluate the new heuristics version
        await self.evaluate_all(rc_manager_current_version, rc_manager_new_version)

        # set the new heuristics version as the current heuristics version
        self.logger.info(f"Setting new heuristics version: {new_heuristics_version_id}")
        await self.redis.set(constants.KV_HEURISTICS_VERSION_ID_KEY, new_heuristics_version_id)

        await self.sync_all_relations(rc_manager_new_version) # sync all relations with the graph database, just in case some relations were not updated
        await rc_manager_new_version.cleanup() # Clear previous ontology

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
        self.processing_tasks_total = 0
        self.processed_tasks_count = 0

        heuristics_processor = HeuristicsProcessor(self.graph_db)
        entity_types = await self.graph_db.get_all_entity_types()
        entities = []
        for entity_type in entity_types:
            entities += await self.graph_db.find_entity(entity_type, {}, max_results=10000)
        
        self.processing_tasks_total = len(entities)
        self.logger.info(f"Processing {len(entities)} entities for heuristics")

        async def process_entity_with_tracking(entity):
            """Wrapper function to track task completion"""
            try:
                await heuristics_processor.process(entity, rc_manager)
            except Exception as e:
                self.logger.error(traceback.format_exc())
                self.logger.error(f"Error processing entity {entity.type}:{entity.pk}: {e}")
            finally:
                self.processed_tasks_count += 1

        tasks = []
        for entity in entities:
            self.logger.debug(f"Processing entity {entity}")
            tasks.append(process_entity_with_tracking(entity))

        self.logger.info(f"{len(tasks)}  entities to be processed, concurrency limit is {self.max_concurrent_processing}")

        await utils.gather(self.max_concurrent_processing, *tasks, logger=self.logger)

        self.is_processing = False
    

    async def evaluate_all(self, rc_manager_current: RelationCandidateManager|None, rc_manager_new: RelationCandidateManager):
        """
        Evaluates all relations in the database.
        :param rc_manager: The relation candidate manager to use. 
        This is meant to be run periodically to update the relations based on the heuristics.
        """        
        self.logger.info("Evaluating all relations for heuristics_version_id: %s", rc_manager_new.heuristics_version_id)
        if self.is_evaluating:
            self.logger.warning("Evaluation is already in progress, skipping this run")
            return

        self.is_evaluating = True
        self.evaluation_tasks_total = 0
        self.evaluated_tasks_count = 0

        # Create a wrapper function for doing the evaluation (with progress update)
        async def evaluation_task_with_tracking(task_id, rc_manager, relation_id):
            """Wrapper function to track evaluation task completion"""
            try:
                await self.evaluation_task(task_id, rc_manager, relation_id)
            except Exception as e:
                self.logger.error(traceback.format_exc())
                self.logger.error(f"Error evaluating relation {relation_id}: {e}")
            finally:
                self.evaluated_tasks_count += 1

        # Fetch the current relation candidates if available
        if rc_manager_current:
            current_relation_candidates = await rc_manager_current.fetch_all_candidates()

        # Get all new relation candidates
        new_relation_candidates = await rc_manager_new.fetch_all_candidates()
        self.evaluation_tasks_total = len(new_relation_candidates)
        self.logger.info(f"Found {len(new_relation_candidates)} relation candidates to evaluate")
        
        # Create tasks for each relation candidate if they pass requirements
        tasks = []
        index = 0
        for rel_id, new_candidate in new_relation_candidates.items():
            
            # Check if there is an existing relation candidate
            current_relation = None
            if rc_manager_current:
                current_relation = current_relation_candidates.get(rel_id, None)
            
            # Check if an existing relation exists and has an evaluation
            if current_relation and current_relation.evaluation:
                # Check if heurisitics changed from last evaluation
                if (helpers.is_accepted(current_relation.evaluation.relation_confidence, self.acceptance_threshold)):
                    # If the heuristic is already evaluated, we can skip it
                    self.logger.info(f"Skipping evaluation for {new_candidate.relation_id}, already accepted with confidence {current_relation.evaluation.relation_confidence}.")
                    continue
                if helpers.is_rejected(current_relation.evaluation.relation_confidence, self.rejection_threshold):
                    # If the heuristic is already evaluated, we can skip it
                    self.logger.info(f"Skipping evaluation for {new_candidate.relation_id}, already rejected with confidence {current_relation.evaluation.relation_confidence}.")
                    continue

                 # If the heuristic count changed less than the threshold ratio, we ignore it
                if current_relation.heuristic.count > 0:
                    count_distance = abs(current_relation.heuristic.count - new_candidate.heuristic.count) / abs(current_relation.heuristic.count)
                    if count_distance < self.count_change_threshold_ratio:
                        self.logger.info(f"Skipping evaluation for {new_candidate.relation_id}, count change ratio {count_distance:.3f} is below threshold {self.count_change_threshold_ratio}.")
                        continue
            
            # Skip if the absolute count is less than the min required
            if new_candidate.heuristic.count < self.min_count_for_eval:
                self.logger.info(f"Skipping evaluation for {new_candidate.relation_id}, count is {new_candidate.heuristic.count} which is below the minimum count for evaluation.")
                continue

            tasks.append(evaluation_task_with_tracking(index, rc_manager_new, new_candidate.relation_id))
            index += 1

        # Run the evaluation tasks concurrently
        await utils.gather(self.max_concurrent_evaluation, *tasks, logger=self.logger)
        self.is_evaluating = False

    async def process(self, rc_manager: RelationCandidateManager, entity_type: str, entity_pk: str):
        """
        Processes a single relation candidate. (Used for debugging)
        """
        self.logger.info("Processing entity %s[%s] for heuristics_version_id: %s", entity_type, entity_pk, rc_manager.heuristics_version_id)
        heuristics_processor = HeuristicsProcessor(self.graph_db)
        entity = await self.graph_db.fetch_entity(entity_type, entity_pk)
        if entity is None:
            self.logger.error(f"Entity {entity_type}:{entity_pk} not found")
            return
        await heuristics_processor.process(entity, rc_manager)

    async def evaluation_task(self, task_id, rc_manager: RelationCandidateManager, relation_id):
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

           
            self.logger.info(f"Evaluating {candidate.relation_id} with count {candidate.heuristic.count}.")
            c = await rc_manager.fetch_candidate(relation_id)
            if c is None:
                self.logger.warning(f"Relation candidate {relation_id} not found, skipping evaluation.")
                return
            await self.evaluate(rc_manager=rc_manager, candidate=c)
            await rc_manager.sync_relation(AGENT_NAME, relation_id)
        except Exception as e:
            self.logger.error(traceback.format_exc())
            self.logger.error(f"Error evaluating relation {relation_id}: {e}")


    def create_agent(self) -> CompiledStateGraph:
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
            property_counts[prop.entity_a_property] = await self.graph_db.get_property_value_count(candidate.heuristic.entity_a_type, prop.entity_a_property, None)
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

        logger.info(f"Evaluating rel_id={candidate.relation_id} with agent")
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

        logger.debug(prompt)
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

            logger.info(f"Agent response: confidence={fkey_agent_response.relation_confidence}, ")
            logger.debug(f"Agent response raw: {fkey_agent_response_raw}")
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


        await rc_manager.update_evaluation(
            relation_id=candidate.relation_id,
            relation_name=fkey_agent_response.relation_name.replace(" ", "_").upper(),
            relation_confidence=float(fkey_agent_response.relation_confidence), 
            justification=str(fkey_agent_response.justification), 
            thought=ai_thought,
            entity_a_property_values=property_values,
            entity_a_property_counts=property_counts,
            evaluation_heuristic_count=candidate.heuristic.count
        )