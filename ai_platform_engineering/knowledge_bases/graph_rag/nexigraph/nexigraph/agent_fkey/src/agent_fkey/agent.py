import asyncio

from langgraph.prebuilt import create_react_agent

from core.agent.tools import fetch_entity
from core.graph_db.neo4j.graph_db import Neo4jDB
import langchain.chat_models.base
from core.constants import FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC
from evaluate import FkeyEvaluator
from heuristics import HeuristicsProcessor
from relation_manager import RelationCandidateManager
from prompts import SYSTEM_PROMPT_1
from core.models import AgentOutputFKeyRelation, RelationCandidate, Entity
from core.msg_pubsub.redis.msg_pubsub import RedisPubSub
from langchain_core.prompts import PromptTemplate
from langgraph.graph.graph import CompiledGraph
from core.utils import runforever
import core.utils as utils
import agent_fkey.helpers as helpers

AGENT_NAME = "ForeignKeyRelationAgent"

AGENT_TOOLS =[fetch_entity]

max_concurrent_processing = 150
max_concurrent_evaluation = 10
agent_max_iterations = 5
agent_recursion_limit = 2 * agent_max_iterations + 1
percent_change_for_eval = 0.2 # 20% change in count needed to trigger re-evaluation

class ForeignKeyRelationAgent:
    """
    This class contains functions for evaluating and processing heuristics as well as the code that
     agent follows to determine relations.
    """

    def __init__(self, acceptance_threshold: float, rejection_threshold: float, min_count_for_eval: int, sync_interval: int):
        """
        Initializes the ForeignKeyRelationAgent with the given parameters.
        Args:
            acceptance_threshold (float): The confidence threshold for accepting a relation.
            rejection_threshold (float): The confidence threshold for rejecting a relation.
            min_count_for_eval (int): The minimum count of matches to consider the heuristic for evaluation.
            sync_interval (int): The interval in seconds to sync the relations with the graph database.
        """
        self.msg_pubsub = RedisPubSub()
        self.graph_db = Neo4jDB()
        self.logger = utils.get_logger("fkey_agent")
        self.min_count_for_eval = min_count_for_eval
        self.acceptance_threshold = acceptance_threshold
        self.rejection_threshold = rejection_threshold
        self.sync_interval = sync_interval
        self.agent = self.create_agent()

    # sync periodically
    async def periodic_agent_run(self):
        self.logger.info("Periodic agent run started.")
        while True:
            self.logger.debug("Sleeping for %s seconds...", self.sync_interval)
            await asyncio.sleep(self.sync_interval)
            await self.process_and_evaluate_all()
    
    async def sync_all_relations(self, rc_manager: RelationCandidateManager):
        """
        Syncs all accepted relations with the graph database.
        This is meant to be run periodically to update the graph database with the latest relations.
        """
        candidates = await rc_manager.fetch_all_candidates()
        for _, candidate in candidates.items():
            await rc_manager.sync_relation(AGENT_NAME, candidate.relation_id)
            # TODO: Gather relations that are no longer candidates, but still exist in the graph database, and remove them
                    
    async def process_and_evaluate_all(self):
        rc_manager = RelationCandidateManager(self.graph_db, self.acceptance_threshold, self.rejection_threshold, new_candidates=True)

        self.logger.info("Running heuristics processing...")
        await self.process_all(rc_manager)

        self.logger.info("Running foreign key relation evaluation...")
        await self.evaluate_all(rc_manager)
        await rc_manager.set_new_candidates_to_current() # save the latest dataset id

        self.logger.info("Syncing all relations with the graph database...")
        await self.sync_all_relations(rc_manager) # sync all relations with the graph database, just in case some relations were not updated


    async def process_all(self, rc_manager: RelationCandidateManager):
        """
        Processes all entities in the database to compute heuristics.
        This is meant to be run periodically to update the heuristics based on the entities in the database.
        """
        heuristics_processor = HeuristicsProcessor(self.graph_db, rc_manager)
        entity_types = await self.graph_db.get_all_entity_types()
        entities = []
        for entity_type in entity_types:
            entities += await self.graph_db.find_entity(entity_type, {}, max_results=10000)
        self.logger.info(f"Processing {len(entities)} entities for heuristics")

        tasks = []
        for index, entity in enumerate(entities):
            tasks.append(self.heuristics_task(index, heuristics_processor, entity))

        self.logger.info(f"{len(tasks)}  entities to be processed, concurrency limit is {max_concurrent_processing}")

        await self.gather(max_concurrent_processing, *tasks) # Type: ignore

    async def evaluate_all(self, rc_manager: RelationCandidateManager):
        """
        Evaluates all relations in the database.
        This is meant to be run periodically to update the relations based on the heuristics.
        """
        self.logger.info("Evaluating all relations")
        # Get all relation candidates
        evaluator = FkeyEvaluator(self.agent, self.graph_db, rc_manager, self.acceptance_threshold)
        relation_candidates = await rc_manager.fetch_all_candidates()
        self.logger.info(f"Found {len(relation_candidates)} relation candidates to evaluate")
        # Create tasks for each relation candidate
        tasks = []
        index = 0
        for _, candidate in relation_candidates.items():
            tasks.append(self.evaluation_task(index, rc_manager, evaluator, candidate.relation_id))
            index += 1

        # Run the evaluation tasks concurrently
        await self.gather(max_concurrent_evaluation, *tasks) # Type: ignore

    @runforever
    async def request_worker(self):
        """
        A worker that listens to a pubsub queue for any manually added requests, and then routes them to the appropriate worker.
        """
        self.logger.info("Starting request router")
        logger = utils.get_logger("fkey_request_router")
        while True:
            logger.info("agent-req-router waiting for requests...")
            request = await self.msg_pubsub.subscribe(FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC)
            logger.info(f"agent-req-router New item picked up: {request}")
            rc_manager = RelationCandidateManager(self.graph_db, self.acceptance_threshold, self.rejection_threshold)

            if not request:
                logger.warning("Empty request")
                continue
            if request == "process_evaluate_all":
                logger.info("Processing and evaluating all relations")
                # process all heuristics and evaluate all relations
                await self.process_and_evaluate_all()
            if request == "evaluate_all":
                logger.info("Evaluating all relations without processing heuristics")
                await self.evaluate_all(rc_manager)
            elif request == "process_all":
                logger.info("Processing all heuristics without evaluation")
                await rc_manager.delete_all_candidates()
                await self.process_all(rc_manager)
            elif request.startswith("evaluate:"):
                # Evaluate a specific relation candidate
                logger.info(f"Evaluating relation candidate {request}")
                relation_id = request.removeprefix("evaluate:")
                await self.evaluation_task(0, rc_manager, FkeyEvaluator(self.agent, self.graph_db, rc_manager, self.acceptance_threshold), relation_id, force=True)
            elif request.startswith("accept:"):
                # Accept a specific relation candidate
                logger.info(f"Accepting relation candidate {request}")
                relation_id = request.removeprefix("accept:")
                await rc_manager.apply_relation(AGENT_NAME, relation_id, manual=True)
            elif request.startswith("reject:"):
                # Reject a specific relation candidate
                logger.info(f"Rejecting relation candidate {request}")
                relation_id = request.removeprefix("reject:")
                await rc_manager.unapply_relation(relation_id, manual=True)
            elif request.startswith("unreject:"):
                # Unreject a specific relation candidate
                logger.info(f"Unrejecting relation candidate {request}")
                relation_id = request.removeprefix("unreject:")
                await rc_manager.unapply_relation(relation_id, manual=False)
            elif request.startswith("process:"): # Only for debugging purposes, to process a single entity, can mess up the heuristics
                # Process a specific entity
                logger.info(f"Processing entity {request} [THIS IS MEANT FOR DEBUGGING PURPOSES ONLY, DO NOT USE FOR ANYTHING ELSE]")
                (entity_type, entity_id) = request.removeprefix("process:").split(",")
                entity = await self.graph_db.get_entity(entity_type=entity_type, primary_key_value=entity_id)  
                if not entity:
                    logger.error(f"Entity {entity_id} not found")
                    continue
                await self.heuristics_task(0, HeuristicsProcessor(self.graph_db, rc_manager), entity)
            else:
                logger.error(f"Unknown request {request}, skipping")


    async def heuristics_task(self, task_id: int, heuristics_processor: HeuristicsProcessor, entity: Entity):
        """
        A task to picks up entity and compute heuristics.
        """
        logger = utils.get_logger(f"heuristics-{task_id}")
        try:
            await heuristics_processor.process(entity)
        except Exception as e:
            logger.error(f"Error processing entity {entity.entity_type}::{entity.generate_primary_key()}: {e}")
            exit(1)

    async def evaluation_task(self, task_id, rc_manager: RelationCandidateManager, evaluator: FkeyEvaluator, relation_id, force=False):
        """
        A worker that picks up entities from the queue and computes heuristics.
        """
        logger = utils.get_logger(f"eval-{task_id}")
        try:
            candidate = await rc_manager.fetch_candidate(relation_id)

            if candidate is None:
                logger.error(f"Candidate for relation {relation_id} not found, skipping evaluation.")
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
                    if count_distance < percent_change_for_eval: # type: ignore
                        self.logger.info(f"Skipping evaluation for {candidate.relation_id}, previous count is less than 20% of current count.")
                        return
            else:
                self.logger.info(f"Evaluating {candidate.relation_id} with count {candidate.heuristic.count}. force={force}, never evaluated={candidate.evaluation is None}")
                c = await rc_manager.fetch_candidate(relation_id)
                await evaluator.evaluate(c)
                await rc_manager.sync_relation(AGENT_NAME, relation_id)
        except Exception as e:
            logger.error(f"Error evaluating relation {relation_id}: {e}")
      

    async def gather(self, n: int, *coros: asyncio.Future):
        """
        Gathers a list of coroutines with a limit on the number of concurrent executions.
        """
        semaphore = asyncio.Semaphore(n)

        async def sem_coro(coro):
            async with semaphore:
                return await coro
        return await asyncio.gather(*(sem_coro(c) for c in coros))
    

    def create_agent(self) -> CompiledGraph:
        # Create the agent
        provider = "azure_openai"
        model = "gpt-4o"
        # provider = "ollama"
        # model = "llama3.2"
        llm = langchain.chat_models.base.init_chat_model(model, model_provider=provider, temperature=0)

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
        agent = create_react_agent(llm, tools=AGENT_TOOLS, prompt=system_prompt, response_format=AgentOutputFKeyRelation)
        agent.name = AGENT_NAME
        return agent

    async def start(self,):
        """
        Starts the workers for heuristics processing.
        """
        self.logger.info("Starting ForeignKeyRelationAgent...")
        self.logger.info(f"Using {max_concurrent_processing} for heuristics processing, {max_concurrent_evaluation} workers for evaluation.")
        async with asyncio.TaskGroup() as tg:
            tg.create_task(self.request_worker()) # works on any manual requests
            tg.create_task(self.periodic_agent_run()) # runs the agent periodically


async def sync_all_relations_manual():
        """
        Syncs all accepted relations with the graph database.
        This is meant to be run periodically to update the graph database with the latest relations.
        """
        # rc_manager = RelationCandidateManager(Neo4jDB(), 0.5, 0.5, new_candidates=True)
        rc_manager = RelationCandidateManager(Neo4jDB(), 0.75, 0.3, new_candidates=False)
        candidates = await rc_manager.fetch_all_candidates()
        for _, candidate in candidates.items():
            try:
                await rc_manager.sync_relation(AGENT_NAME, candidate.relation_id)
            except Exception as e:
                print(f"Error syncing relation {candidate.relation_id}: {e}")

if __name__ == "__main__":
     asyncio.run(sync_all_relations_manual())