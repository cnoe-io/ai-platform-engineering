import os
import pytest
import pytest_asyncio
import logging
import json
from agent_ontology.relation_manager import RelationCandidateManager

from core.graph_db.neo4j.graph_db import Neo4jDB
from core.utils import ObjEncoder, get_default_fresh_until

from core.models import RelationCandidate

from core.models import Entity


from agent_ontology.heuristics import HeuristicsProcessor
from core.constants import DEFAULT_LABEL, UPDATED_BY_KEY


TEST_DATA_HEURISTICS_FILE = "test_data_heuristics.json"
TEST_DATA_FILE = "../../../../test_data.json"

graph_db = Neo4jDB()
ontology_graph_db = Neo4jDB("bolt://localhost:7688")

rc = RelationCandidateManager(graph_db=graph_db, ontology_graph_db=ontology_graph_db, heuristics_version_id="test", acceptance_threshold=0.75, rejection_threshold=0.3)
hp = HeuristicsProcessor(graph_db=graph_db)

ground_truth_candidates = {}

CLIENT_NAME = "test_heuristics_e2e_client"

@pytest_asyncio.fixture(autouse=True, scope="session")
async def initialise():

    # Clear existing data for the client
    logging.info("Clearing existing data for the client...")
    await ontology_graph_db.raw_query("MATCH ()-[r]-() DELETE r")
    await ontology_graph_db.raw_query("MATCH (n) DETACH DELETE n") 
    await graph_db.raw_query("MATCH ()-[r]-() DELETE r")
    await graph_db.raw_query("MATCH (n) DETACH DELETE n") 
    # await rc.cleanup()

    logging.info("Loading test data...")
    with open(TEST_DATA_FILE, "r") as f:
        data = json.load(f)

    # create entities directory if it doesn't exist
    if not os.path.exists("entities"):
        os.makedirs("entities")

    logging.info("Writing test data to the database...")
    for i, entity in enumerate(data["entities"]):
        logging.info(f"Creating entity {i}...")
        entity = Entity.model_validate(entity)
        
        # write entity to a file
        with open(f"entities/{i}.json", "w") as ef:
            json.dump(entity.model_dump(), ef, cls=ObjEncoder, indent=2)

        await graph_db.update_entity(entity, client_name=CLIENT_NAME, fresh_until=get_default_fresh_until())
    
    # Process all entities in the database, and compute heuristics
    logging.info("Processing all entities in the database...")
    # await rc.cleanup()
    entities = await graph_db.find_entity(DEFAULT_LABEL, properties={
        UPDATED_BY_KEY: CLIENT_NAME
    })
    for entity in entities:
        logging.info(f"Processing entity ({entity.entity_type}) {entity.generate_primary_key()}...")
        await hp.process(entity, rc_manager=rc)
        logging.info(f"Finished processing entity ({entity.entity_type}) {entity.generate_primary_key()}.")
    
    # Load up ground truth data
    logging.info("Loading ground truth data...")
    with open(TEST_DATA_HEURISTICS_FILE, "r") as f:
        data = json.load(f)
        for rel_id, candidate in data.items():
            ground_truth_candidates[rel_id] = RelationCandidate.model_validate(candidate)

@pytest.mark.asyncio(loop_scope="session")
async def test_total_count():
    test_candidates = await rc.fetch_all_candidates()
    gtcs = set(ground_truth_candidates.keys())
    tcs = set(test_candidates.keys())
    diff_tcs = tcs.difference(gtcs)
    diff_gtcs = gtcs.difference(tcs)
    logging.warning(f"[TEST] Testing relation candidate count, expected {len(ground_truth_candidates)}, got {len(test_candidates)}")
    logging.warning("Difference in relation candidates (in test, not in ground truth):")
    for rel_id in diff_tcs:
        logging.warning(f"  - {rel_id}")
        c = test_candidates[rel_id]
        logging.warning(f"    - {c.heuristic.entity_a_type} -> {c.heuristic.entity_b_type}")
        logging.warning(f"    - {c.heuristic.property_mappings}")
    logging.warning("Difference in relation candidates (in ground truth, not in test):")
    for rel_id in diff_gtcs:
        logging.warning(f"  - {rel_id}")
    
    assert len(ground_truth_candidates) == len(test_candidates), f"Mismatch in candidate counts, expected {len(ground_truth_candidates)}, got {len(test_candidates)}"
    assert len(diff_tcs) == 0, f"Found {len(diff_tcs)} relation candidates in test that are not in ground truth: {diff_tcs}"
    assert len(diff_gtcs) == 0, f"Found {len(diff_gtcs)} relation candidates in ground truth that are not in test: {diff_gtcs}"

@pytest.mark.asyncio(loop_scope="session")
async def test_relation_candidate_count():
    test_candidates = await rc.fetch_all_candidates()
    for rel_id, ground_truth_candidate in ground_truth_candidates.items():
        if rel_id not in test_candidates:
            logging.warning(f"Relation ID {rel_id} not found in test candidates.")
            continue
        test_candidate = test_candidates[rel_id]
        if ground_truth_candidate.heuristic.count != test_candidate.heuristic.count:
            logging.warning(f"[TEST] Testing relation candidate count for {rel_id}, expected {ground_truth_candidate.heuristic.count}, got {test_candidate.heuristic.count}")
        assert ground_truth_candidate.heuristic.count == test_candidate.heuristic.count, f"Mismatch in count for {rel_id}, expected {ground_truth_candidate.heuristic.count}, got {test_candidate.heuristic.count}"


# async def fetch_all():
#     """    
#     Fetch all relation candidates and save them to a JSON file. Used to update the test data for heuristics.
#     Used to update the test data for heuristics.
#     """
#     candidates = await rc.fetch_all_candidates()
#     output={}
#     for rel_id, candidate in candidates.items():
#         print(f"Candidate: {candidate}")
#         if candidate.evaluation is not None:
#             candidate.evaluation.relation_confidence = 1.0
#             candidate.evaluation.justification = ""
#             candidate.evaluation.thought = ""
#         candidate.is_applied = False
#         output[rel_id] = candidate.model_dump() 
#     with open("new_"+TEST_DATA_HEURISTICS_FILE, "w") as f:

#         json.dump(output, f, indent=4, cls=ObjEncoder)

# def main():
#     import asyncio
#     asyncio.run(fetch_all())

# if __name__ == "__main__":
#     main()