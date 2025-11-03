import asyncio
import json
import logging
from common.key_value.redis.key_value_store import RedisKVStore
import pytest
from core.models import RelationCandidate
from core.graph_db.neo4j.graph_db import Neo4jDB
from agent_ontology.relation_manager import RelationCandidateManager
from agent_ontology.agent import OntologyAgent
from core.utils import get_default_fresh_until
from core.models import Entity
from core.key_value.base import KVStore

TEST_DATA_HEURISTICS_FILE = "test_data_heuristics.json"
TEST_DATA_FILE = "../../../../test_data.json"

graph_db = Neo4jDB()
ontology_graph_db = Neo4jDB("bolt://localhost:7688")
kv_store : KVStore = RedisKVStore()
ground_truth_candidates = {}
CLIENT_NAME = "test_heuristics_e2e_client"
TEST_DATA_HEURISTICS_FILE = "test_data_heuristics.json"

rc = RelationCandidateManager(graph_db=graph_db, ontology_graph_db=ontology_graph_db, heuristics_version_id="test", client_name=CLIENT_NAME)

async def initialise():

    # Clear existing data for the client
    logging.info("Clearing existing data for the client...")
    await graph_db.raw_query("MATCH ()-[r]-() DELETE r")
    await graph_db.raw_query("MATCH (n) DETACH DELETE n")
    await ontology_graph_db.raw_query("MATCH ()-[r]-() DELETE r")
    await ontology_graph_db.raw_query("MATCH (n) DETACH DELETE n") 
    # await rc.cleanup()

    logging.info("Waiting 10s for the database to clear...")
    await asyncio.sleep(10)  # Give some time for the database to clear

    logging.info("Loading test data...")
    with open(TEST_DATA_FILE, "r") as f:
        data = json.load(f)

    logging.info("Writing test data to the database...")
    for entity in data["entities"]:
        logging.info(f"Creating entity {entity}...")
        entity = Entity.model_validate(entity)
        await graph_db.update_entity(entity, client_name=CLIENT_NAME, fresh_until=get_default_fresh_until())
    
    # Load up ground truth data
    logging.info("Loading ground truth data...")
    with open(TEST_DATA_HEURISTICS_FILE, "r") as f:
        data = json.load(f)
        for rel_id, candidate in data.items():
            ground_truth_candidates[rel_id] = RelationCandidate.model_validate(candidate)
    
    logging.info("Finished initialising test data.")


@pytest.mark.asyncio(loop_scope="session")
async def test_each_evaluation():

    number_of_tests = 3
    for i in range(number_of_tests):
        logging.info(f"Running test {i + 1}/{number_of_tests}...")
        await initialise()
    
        agent = OntologyAgent(graph_db=graph_db, 
            ontology_graph_db=ontology_graph_db, 
            kv_store=kv_store, 
            min_count_for_eval=1, 
            count_change_threshold_ratio=0.2, 
            max_concurrent_processing=30, 
            max_concurrent_evaluation=5,
            agent_recursion_limit=10
            )
        logging.info("Running heuristics processing...")
        await agent.process_all(rc)

        logging.info("Running foreign key relation evaluation...")
        await agent.evaluate_all(rc)

        logging.info("Starting evaluation of relation candidates...")
        logging.info("Sleep for 5 seconds to allow the agent to process the candidates...")
        await asyncio.sleep(5)  # Give some time for the agent to process, await should be enough, but just in case

        logging.info("Fetching all relation candidates...")
        test_candidates = await rc.fetch_all_candidates()
        logging.info(f"Fetched {len(test_candidates)} relation candidates")
        logging.info(test_candidates)
        logs = []
        tp = 0
        tn = 0
        fp = 0
        fn = 0
        total_candidates = 0
        logging.info(f"Testing relation candidates...{len(ground_truth_candidates)}")
        for rel_id, ground_truth_candidate in ground_truth_candidates.items():
            logging.info(f"Testing relation candidate {rel_id}...")
            expected_confidence = ground_truth_candidate.evaluation.relation_confidence
            test_evaluation = test_candidates[rel_id].evaluation
            logging.info(ground_truth_candidate)
            logging.info(test_evaluation)
            assert test_evaluation is not None, f"Test evaluation for relation candidate {rel_id} is None"
            test_confidence = test_evaluation.relation_confidence            
            if expected_confidence > rc.acceptance_threshold and test_confidence >= rc.acceptance_threshold:
                tp += 1
                logs.append(f"True Positive: {rel_id} - Expected: {expected_confidence}, Test: {test_confidence}")
            elif expected_confidence < rc.rejection_threshold and test_confidence <= rc.rejection_threshold:
                tn += 1
                logs.append(f"True Negative: {rel_id} - Expected: {expected_confidence}, Test: {test_confidence}")
            elif expected_confidence > rc.acceptance_threshold and test_confidence < rc.acceptance_threshold:
                fn += 1
                logs.append(f"False Negative: {rel_id} - Expected: {expected_confidence}, Test: {test_confidence}")
            elif expected_confidence < rc.rejection_threshold and test_confidence > rc.rejection_threshold:
                fp += 1
                logs.append(f"False Positive: {rel_id} - Expected: {expected_confidence}, Test: {test_confidence}")
            else:
                logging.warning(f"Discounting this candidate from evaluation. Expected: {expected_confidence}, Test: {test_confidence}")
                continue

            total_candidates += 1
            
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        accuracy = (tp + tn) / (tp + tn + fp + fn) if (tp + tn + fp + fn) > 0 else 0
        f1_score = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0

        logs.append(f"Test {i + 1} Results:")
        logs.append(f"True Positives: {tp}, True Negatives: {tn}, False Positives: {fp}, False Negatives: {fn}")
        logs.append(f"Precision: {precision}, Recall: {recall}, Accuracy: {accuracy}, F1 Score: {f1_score}")

        logging.warning(logs)
        with open(f"test_results_{i + 1}._log", "w") as f:
            for log in logs:
                f.write(log + "\n")
        
        # Currently, we expect at least 70% of the candidates to be evaluated correctly, over time we expect this to increase, as the evaluation improves.
        assert (tp + tn) / total_candidates >= 0.7, f"Expected at least 70% of the candidates to be evaluated correctly, but got {(tp + tn) / total_candidates}"
