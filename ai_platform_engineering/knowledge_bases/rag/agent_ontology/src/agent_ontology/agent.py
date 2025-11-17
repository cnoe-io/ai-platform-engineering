import logging
import os
import traceback

from common.graph_db.base import GraphDB
from langchain_core.tools.structured import StructuredTool
from langgraph.prebuilt import create_react_agent
from agent_ontology.heuristics import HeuristicsProcessor
from agent_ontology.relation_manager import RelationCandidateManager
from agent_ontology.prompts import RELATION_PROMPT, SYSTEM_PROMPT_1
from common.models.ontology import RelationCandidate, FkeyEvaluationResult
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.prompts import PromptTemplate
from langgraph.graph.state import CompiledStateGraph
import gc
import redis.asyncio as redis
import common.utils as utils
from common import constants
from cnoe_agent_utils import LLMFactory



class OntologyAgent:
    """
    This class contains functions for evaluating and processing heuristics as well as the code that
     agent follows to determine relations.
    """

    def __init__(self, graph_db: GraphDB, ontology_graph_db: GraphDB, redis : redis.Redis, min_count_for_eval: int, 
                 count_change_threshold_ratio: float, max_concurrent_processing: int, max_concurrent_evaluation: int, agent_recursion_limit: int):
        """
        Initializes the OntologyAgent with the given parameters.
        Args:
            graph_db (GraphDB): The graph database to use.
            ontology_graph_db (GraphDB): The ontology graph database to use.
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
        self.min_count_for_eval = min_count_for_eval
        self.count_change_threshold_ratio = count_change_threshold_ratio
        self.max_concurrent_processing = max_concurrent_processing
        self.max_concurrent_evaluation = max_concurrent_evaluation
        self.agent_recursion_limit = agent_recursion_limit
        self.agent_name = "OntologyAgent"
        self.last_evaluation_run_timestamp = 0

        # status flags
        self.is_processing = False # Avoid parallel processing/evaluation
        self.is_evaluating = False
        self.processing_tasks_total = 0
        self.processed_tasks_count = 0
        self.evaluation_tasks_total = 0
        self.evaluated_tasks_count = 0

        self.debug = os.getenv("DEBUG_AGENT", "false").lower() in ("true", "1", "yes")
        
        # Current relation candidate manager for tool context
        self._eval_relation_manager: RelationCandidateManager | None = None
        
        self.agent = self.create_agent()

    async def sync_all_relations(self, rc_manager: RelationCandidateManager):
        """
        Syncs all accepted relations with the graph database.
        """
        self.logger.info("Syncing all relations with the graph database...")
        candidates = await rc_manager.fetch_all_candidates()
        for _, candidate in candidates.items():
            await rc_manager.sync_relation(candidate.relation_id)
            # TODO: Gather relations that are no longer candidates, but still exist in the graph database, and remove them

    async def fetch_entity(self, entity_type: str, primary_key_id: str, thought: str) -> str:
        """
        Fetches a single entity and returns all its properties from the graph database.
        Args:
            entity_type (str): The type of entity
            primary_key_id (str):  The primary key id of the entity
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: The properties of the entity
        """
        self.logger.info(f"Fetching entity of type {entity_type} with primary_key_id {primary_key_id}, Thought: {thought}")
        if self.graph_db is None:
            self.logger.error("Graph database is not available, Is graph RAG enabled?")
            return "Error: graph database is not available."
        try:
            entity = await self.graph_db.fetch_entity(entity_type, primary_key_id)
            if entity is None:
                return f"no entity of type {entity_type} with primary_key_id {primary_key_id}"
            return utils.json_encode(entity.get_external_properties())
        except Exception as e:
            self.logger.error(f"Traceback: {traceback.format_exc()}")
            self.logger.error(f"Error fetching entity {entity_type} with primary_key_id {primary_key_id}: {e}")
            return f"Error fetching entity {entity_type} with primary_key_id {primary_key_id}: {e}"

    async def accept_relation(self, relation_id: str, relation_name: str, justification: str) -> str:
        """
        Accepts a relation candidate by updating its evaluation to ACCEPTED.
        Args:
            relation_id (str): The ID of the relation to accept
            relation_name (str): The name of the relation
            justification (str): Justification for accepting the relation

        Returns:
            str: Success or error message
        """
        self.logger.debug(f"Accepting relation {relation_id} with name '{relation_name}'")
        try:
            # Get the current relation candidate manager (this assumes we're in evaluation context)
            if not hasattr(self, '_eval_relation_manager') or self._eval_relation_manager is None:
                return "Error: No relation candidate manager available in current context"
            
            if relation_name.strip() == "":
                return "Error: Relation name cannot be empty when accepting a relation. Please provide a valid relation name."

            await self._eval_relation_manager.update_evaluation(
                relation_id=relation_id,
                relation_name=relation_name.replace(" ", "_").upper(),
                result=FkeyEvaluationResult.ACCEPTED,
                justification=justification,
                thought="",
                is_manual=True
            )
            self.logger.info(f"Successfully accepted relation {relation_id}")
            return f"Successfully accepted relation {relation_id} with name '{relation_name}'"
        except Exception as e:
            self.logger.error(traceback.format_exc())
            self.logger.error(f"Error accepting relation {relation_id}: {e}")
            return f"Error accepting relation {relation_id}: {e}"

    async def reject_relation(self, relation_id: str, justification: str) -> str:
        """
        Rejects a relation candidate by updating its evaluation to REJECTED.
        Args:
            relation_id (str): The ID of the relation to reject
            justification (str): Justification for rejecting the relation

        Returns:
            str: Success or error message
        """
        self.logger.debug(f"Rejecting relation {relation_id}, Justification: {justification}")
        try:
            # Get the current relation candidate manager (this assumes we're in evaluation context)
            if not hasattr(self, '_eval_relation_manager') or self._eval_relation_manager is None:
                return "Error: No relation candidate manager available in current context"
            
            await self._eval_relation_manager.update_evaluation(
                relation_id=relation_id,
                relation_name=self._eval_relation_manager.generate_placeholder_relation_name(relation_id),
                result=FkeyEvaluationResult.REJECTED,
                justification=justification,
                thought="",
                is_manual=True,
            )
            self.logger.info(f"Successfully rejected relation {relation_id}")
            return f"Successfully rejected relation {relation_id}'"
        except Exception as e:
            self.logger.error(traceback.format_exc())
            self.logger.error(f"Error rejecting relation {relation_id}: {e}")
            return f"Error rejecting relation {relation_id}: {e}"

    async def process_and_evaluate_all(self):
        self.logger.info("Running heuristics processing and the evaluation...")
        # self.last_evaluation_run_timestamp = time.time()

        # create a new ontology version
        new_ontology_version_id = utils.get_uuid()
        self.logger.info(f"Created new ontology version: {new_ontology_version_id}")

        # use the new ontology version for processing and evaluation
        rc_manager_new_version = RelationCandidateManager(self.graph_db, self.ontology_graph_db, new_ontology_version_id, self.agent_name)

        # fetch the current ontology version
        current_ontology_version_id = await self.redis.get(constants.KV_ONTOLOGY_VERSION_ID_KEY)
        rc_manager_current_version = None
        if current_ontology_version_id:
            rc_manager_current_version = RelationCandidateManager(self.graph_db, self.ontology_graph_db, current_ontology_version_id, self.agent_name)
            self.logger.info(f"Current ontology version: {current_ontology_version_id}, new version: {new_ontology_version_id}")
        else:
            self.logger.info("No current ontology version found, this seems to be the first run.")

        await self.process_all(rc_manager_new_version)
        if new_ontology_version_id is None:
            self.logger.error("Heuristics processing failed, skipping evaluation")
            return

        # Evaluate the new heuristics version
        await self.evaluate_all(rc_manager_current_version, rc_manager_new_version)

        # set the new ontology version as the current ontology version
        self.logger.info(f"Setting new ontology version: {new_ontology_version_id}")
        await self.redis.set(constants.KV_ONTOLOGY_VERSION_ID_KEY, new_ontology_version_id)

        await self.sync_all_relations(rc_manager_new_version) # sync all relations with the graph database, just in case some relations were not updated
        await rc_manager_new_version.cleanup() # Clear all previous ontology

        # invoke the garbage collector to free up memory
        gc.collect()

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
        :param rc_manager_current: (Optional) The relation candidate manager for the current ontology version. Used to compare against existing evaluations.
        :param rc_manager_new: The relation candidate manager for the new ontology version.
        This is meant to be run periodically to update the relations based on the ontology.
        """        
        self.logger.info("Evaluating all relations for ontology_version_id: %s", rc_manager_new.ontology_version_id)
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

            # Check if an existing relation exists and has an evaluation, if so check its validity
            if current_relation and current_relation.evaluation:
                
                is_current_eval_still_valid = False

                # Check if its evaluation is manual
                if current_relation.evaluation.is_manual:
                    self.logger.info(f"Skipping evaluation for {new_candidate.relation_id}, current evaluation is manual.")
                    is_current_eval_still_valid = True

                # Check if the heuristic count changed from last time (if the change is less than the threshold ratio, we ignore it)
                if current_relation.heuristic.count > 0:
                    count_distance = abs(current_relation.heuristic.count - new_candidate.heuristic.count) / abs(current_relation.heuristic.count)
                    if count_distance < self.count_change_threshold_ratio:
                        self.logger.info(f"Skipping evaluation for {new_candidate.relation_id}, count hasnt changed much since last time (ratio={count_distance:.3f} is below threshold {self.count_change_threshold_ratio}).")
                        is_current_eval_still_valid = True
                
                # If still valid, copy over the evaluation to the new candidate and skip re-evaluation
                if is_current_eval_still_valid:
                    await rc_manager_new.update_evaluation(
                            relation_id=new_candidate.relation_id,
                            relation_name=current_relation.evaluation.relation_name,
                            justification=current_relation.evaluation.justification,
                            thought=current_relation.evaluation.thought,
                            result=current_relation.evaluation.result,
                            is_manual=current_relation.evaluation.is_manual
                        )
                    continue
            
            # Skip if the absolute count is less than the min required
            if new_candidate.heuristic.count < self.min_count_for_eval:
                self.logger.info(f"Skipping evaluation for {new_candidate.relation_id}, count is {new_candidate.heuristic.count} which is below the minimum count for evaluation.")
                await rc_manager_new.update_evaluation(
                            relation_id=new_candidate.relation_id,
                            relation_name=rc_manager_new.generate_placeholder_relation_name(new_candidate.relation_id),
                            justification=f"Count below minimum threshold for evaluation. ({new_candidate.heuristic.count} < {self.min_count_for_eval})",
                            thought="Automatically classed as unsure due to low count.",
                            result=FkeyEvaluationResult.UNSURE,
                            is_manual=False
                        )
                continue
                            
            
            # Create the evaluation task
            self.logger.debug(f"Scheduling evaluation for relation candidate {new_candidate.relation_id}")
            tasks.append(evaluation_task_with_tracking(index, rc_manager_new, new_candidate.relation_id))
            index += 1

        # Run the evaluation tasks concurrently
        await utils.gather(self.max_concurrent_evaluation, *tasks, logger=self.logger)

        self.is_evaluating = False

    async def process(self, rc_manager: RelationCandidateManager, entity_type: str, entity_pk: str):
        """
        Processes a single relation candidate. (Used for debugging)
        """
        self.logger.info("Processing entity %s[%s] for ontology_version_id: %s", entity_type, entity_pk, rc_manager.ontology_version_id)
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
        logger.info(f"Evaluating relation candidate {relation_id} for ontology_version_id: {rc_manager.ontology_version_id}")
        try:
            candidate = await rc_manager.fetch_candidate(relation_id)
            if candidate is None:
                logger.warning(f"Candidate for relation {relation_id} not found, skipping evaluation.")
                return
            await self.evaluate(logger=logger, rc_manager=rc_manager, candidate=candidate)
        except Exception as e:
            logger.error(traceback.format_exc())
            logger.error(f"Error evaluating relation {relation_id}: {e}")


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
        tools = [
            StructuredTool.from_function(coroutine=self.fetch_entity),
            StructuredTool.from_function(coroutine=self.accept_relation),
            StructuredTool.from_function(coroutine=self.reject_relation)
        ]
        # response_format=("The last message is the evaluation of a relation candidate, using only the evaluation text, generate a structured response. "
        #                            f"If the evaluation text mentions as a {FkeyEvaluationResult.ACCEPTED} relations then output `{FkeyEvaluationResult.ACCEPTED}` for result, if it mentions {FkeyEvaluationResult.REJECTED} then output `{FkeyEvaluationResult.REJECTED}` for result. "
        #                            f"For all other cases output `{FkeyEvaluationResult.UNSURE}` for result." 
        #                            "DO NOT use your own knowledge, only use the evaluation text to generate the response.",
        #                             AgentOutputFKeyRelation)
        agent = create_react_agent(llm, tools=tools, prompt=system_prompt)
        agent.name = self.agent_name
        return agent

    async def evaluate(self, logger: logging.Logger, rc_manager: RelationCandidateManager, relation_id: str = "", candidate: RelationCandidate|None = None):
        """
        Agentic evaluation of heuristic.

        Args:
            rc_manager (RelationCandidateManager): Relation candidate manager.
            relation_id (str, optional): Relation candidate ID. Defaults to "".
            candidate (RelationCandidate|None, optional): Relation candidate. Defaults to None.
        """
        logger.info(f"Evaluating relation candidate {relation_id} for ontology_version_id: {rc_manager.ontology_version_id}")
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


        logger.info(f"Evaluating rel_id={candidate.relation_id} with agent")
        prompt_tpl = PromptTemplate.from_template(RELATION_PROMPT)
        prompt = prompt_tpl.format(
            relation_id=candidate.relation_id,
            entity_a=candidate.heuristic.entity_a_type,
            entity_b=candidate.heuristic.entity_b_type,
            property_mappings=utils.json_encode(candidate.heuristic.property_mappings, indent=2),
            count=candidate.heuristic.count,
            values=property_values,
            entity_a_with_property_counts=property_counts,
            example_matches=utils.json_encode(candidate.heuristic.example_matches, indent=2),
        )

        logger.debug(prompt)
        if self.debug:
            await self.reject_relation(relation_id=candidate.relation_id, justification="Debug mode - auto rejected.")
        else:
            # Set the current rc_manager for tool context
            self._eval_relation_manager = rc_manager
            
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
            
            # fetch the relation candidate
            candidate = await rc_manager.fetch_candidate(relation_id=candidate.relation_id)

            if candidate is None:
                # this should not happen, but just in case
                raise ValueError("Relation candidate is None after agent evaluation, skipping update.")

            # check if evaluation was done
            if candidate.evaluation and candidate.evaluation.last_evaluated > 0:
                logger.debug(f"Agent evaluation for relation_id={candidate.relation_id}: {candidate.evaluation}")
                candidate.evaluation.thought = ai_thought
                try:
                    await rc_manager.update_evaluation(
                        relation_id=candidate.relation_id,
                        relation_name=candidate.evaluation.relation_name,
                        result=candidate.evaluation.result,
                        justification=candidate.evaluation.justification,
                        thought=ai_thought,
                        is_manual=False
                        )
                except Exception as e:
                    logger.error(traceback.format_exc())
                    logger.error(f"Error updating evaluation for relation_id={candidate.relation_id}: {e}")
            else:
                logger.info(f"No evaluation was made by the agent for relation_id={candidate.relation_id}, marking as UNSURE.")
                try:
                    await rc_manager.update_evaluation(
                        relation_id=candidate.relation_id,
                        relation_name=rc_manager.generate_placeholder_relation_name(candidate.relation_id),
                        result=FkeyEvaluationResult.UNSURE,
                        justification="No evaluation was made by the agent.",
                        thought=ai_thought,
                        is_manual=False,
                    )
                except Exception as e:
                    logger.error(traceback.format_exc())
                    logger.error(f"Error updating evaluation for relation_id={candidate.relation_id}: {e}")

    
        logger.info(f"Evaluation completed for relation_id={candidate.relation_id}")
