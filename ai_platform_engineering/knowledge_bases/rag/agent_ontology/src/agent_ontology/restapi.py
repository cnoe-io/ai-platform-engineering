import os
from contextlib import asynccontextmanager

from agent_ontology.agent import OntologyAgent, RelationCandidateManager
from common.graph_db.base import GraphDB
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from common import constants, utils
from common.graph_db.neo4j.graph_db import Neo4jDB
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import dotenv
import uvicorn
import redis.asyncio as redis

# Load environment variables from .env file
dotenv.load_dotenv()

logger = utils.get_logger("restapi")

port = int(os.getenv("SERVER_PORT", 8098))
SYNC_INTERVAL = int(os.getenv('SYNC_INTERVAL', 21600)) # 6 hours by default
ACCEPTANCE_THRESHOLD = float(os.getenv('ACCEPTANCE_THRESHOLD', float(0.75))) # > 75% by default
REJECTION_THRESHOLD = float(os.getenv('REJECTION_THRESHOLD', float(0.3))) # < 40% by default
MIN_COUNT_FOR_EVAL = int(os.getenv('MIN_COUNT_FOR_EVAL', int(3))) # 3 by default
COUNT_CHANGE_THRESHOLD_RATIO = float(os.getenv('COUNT_CHANGE_THRESHOLD_RATIO', float(0.1))) # 10% by default
MAX_CONCURRENT_PROCESSING = int(os.getenv('MAX_CONCURRENT_PROCESSING', int(40))) # 40 by default
MAX_CONCURRENT_EVALUATION = int(os.getenv('MAX_CONCURRENT_EVALUATION', int(10))) # 10 by default

GRAPH_DB_CLIENT_NAME="web_manual"

scheduler = AsyncIOScheduler()

# Initialize dependencies
logger.info("Initializing data graph database...")
graph_db: GraphDB = Neo4jDB()

logger.info("Initializing ontology graph database...")
ontology_graph_db: GraphDB = Neo4jDB(uri=os.getenv("NEO4J_ONTOLOGY_ADDR", "bolt://localhost:7688"))

logger.info("Initializing key-value store...")
redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

logger.info("Initializing ontology agent...")
logger.info("Config:\nAcceptance threshold: %s\nRejection threshold: %s\nMax concurrent processing: %s\nMax concurrent evaluation: %s\nCount change threshold ratio: %s\nMin count for eval: %s", 
            ACCEPTANCE_THRESHOLD, REJECTION_THRESHOLD, MAX_CONCURRENT_PROCESSING, MAX_CONCURRENT_EVALUATION, COUNT_CHANGE_THRESHOLD_RATIO, MIN_COUNT_FOR_EVAL)
agent: OntologyAgent = OntologyAgent(graph_db=graph_db,
                                        ontology_graph_db=ontology_graph_db,
                                        redis=redis_client,
                                        acceptance_threshold=ACCEPTANCE_THRESHOLD,
                                        rejection_threshold=REJECTION_THRESHOLD,
                                        min_count_for_eval=MIN_COUNT_FOR_EVAL,
                                        count_change_threshold_ratio=COUNT_CHANGE_THRESHOLD_RATIO,
                                        max_concurrent_processing=MAX_CONCURRENT_PROCESSING,
                                        max_concurrent_evaluation=MAX_CONCURRENT_EVALUATION,
                                    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Setting up key-value store with heuristics version")
    
    # Fetch latest heuristics version
    heuristics_version_id = await redis_client.get(constants.KV_HEURISTICS_VERSION_ID_KEY)
    if heuristics_version_id is None: # if no heuristics version is found, create one
        heuristics_version_id = utils.get_uuid()
        await redis_client.set(constants.KV_HEURISTICS_VERSION_ID_KEY, heuristics_version_id)

    logger.info("Running the ontology agent periodically every %s seconds ...", SYNC_INTERVAL)
    scheduler.add_job(agent.process_and_evaluate_all, trigger=IntervalTrigger(seconds=SYNC_INTERVAL))
    scheduler.start()
    
    # Yield control to the event loop to allow server to start
    yield

app = FastAPI(title="Ontology Agent Admin Server", lifespan=lifespan)

async def get_rc_manager_with_latest_heuristics() -> RelationCandidateManager:
    heuristics_version_id = await redis_client.get(constants.KV_HEURISTICS_VERSION_ID_KEY)
    if heuristics_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Heuristics version not found")
    return RelationCandidateManager(graph_db, ontology_graph_db, ACCEPTANCE_THRESHOLD, REJECTION_THRESHOLD, heuristics_version_id.decode('utf-8'))
    
#####
# API Endpoints for manual relation management
#####
@app.post("/v1/graph/ontology/agent/relation/accept/{relation_id:path}")
async def accept_relation(relation_id: str):
    """
    Accepts a foreign key relation
    """
    logger.warning("Accepting foreign key relation %s", relation_id)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await rc_manager.apply_relation(GRAPH_DB_CLIENT_NAME, relation_id, manual=True) # TODO: change client name to something more meaningful
    
    return JSONResponse(status_code=200, content={"message": "Foreign key relation accepted"})

@app.post("/v1/graph/ontology/agent/relation/reject/{relation_id:path}")
async def reject_relation(relation_id: str):
    """
    Reject a foreign key relation
    """
    logger.warning("Rejecting foreign key relation %s", relation_id)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await rc_manager.unapply_relation(relation_id, manual=True) # setting manual=True will explicitly reject the relation
    return JSONResponse(status_code=200, content={"message": "Foreign key relation rejected"})

@app.post("/v1/graph/ontology/agent/relation/un_reject/{relation_id:path}")
async def unreject_relation(relation_id: str):
    """
    Undo an accepted or rejected foreign key relation
    """
    logger.warning("Un-rejecting foreign key relation %s", relation_id)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await rc_manager.unapply_relation(relation_id) # manual=False by default, so it will be undone without explicitly rejecting
    return JSONResponse(status_code=200, content={"message": "Foreign key relation un-rejected"})

@app.post("/v1/graph/ontology/agent/relation/evaluate/{relation_id:path}")
async def evaluate_relation(relation_id: str):
    """
    Asks the agent to reevaluate a single foreign key relation
    """
    logger.warning("Re-evaluating foreign key relation %s", relation_id)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await agent.evaluate(rc_manager=rc_manager, relation_id=relation_id)
    return JSONResponse(status_code=200, content={"message": "Submitted"})


@app.post("/v1/graph/ontology/agent/relation/sync/{relation_id:path}")
async def sync_relation(relation_id: str):
    """
    Syncs a single foreign key relation with the graph database
    """
    logger.warning("Syncing foreign key relation %s", relation_id)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await rc_manager.sync_relation(GRAPH_DB_CLIENT_NAME, relation_id)
    return JSONResponse(status_code=200, content={"message": "Submitted"})


@app.post("/v1/graph/ontology/agent/regenerate_ontology")
async def regenerate_ontology(background_tasks: BackgroundTasks):
    """
    Asks the agent to regenerate the ontology graph based on current foreign key relations in the data graph
    """
    logger.warning("Regenerating ontology graph")
    if agent.is_processing or agent.is_evaluating:
        return JSONResponse(status_code=400, content={"message": "Heuristics processing is in progress"})
    background_tasks.add_task(agent.process_and_evaluate_all)
    return JSONResponse(status_code=200, content={"message": "Submitted"})

@app.delete("/v1/graph/ontology/agent/clear")
async def clear_ontology():
    """
    Clears all foreign key relations and the ontology graph
    """
    logger.warning("Clearing all foreign key relations and the ontology graph")
    if agent.is_processing or agent.is_evaluating:
        return JSONResponse(status_code=400, content={"message": "Heuristics processing is in progress"})
    heuristics_version_id = await redis_client.get(constants.KV_HEURISTICS_VERSION_ID_KEY)
    if heuristics_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Heuristics version not found")
    heuristics_version_id = heuristics_version_id.decode('utf-8')
    await agent.ontology_graph_db.remove_relation(None, {constants.HEURISTICS_VERSION_ID_KEY: heuristics_version_id})
    await agent.ontology_graph_db.remove_entity(None, {constants.HEURISTICS_VERSION_ID_KEY: heuristics_version_id})
    return JSONResponse(status_code=200, content={"message": "Cleared"})

@app.get("/v1/graph/ontology/agent/heuristics_version")
async def get_heuristics_version():
    heuristics_version_id = await redis_client.get(constants.KV_HEURISTICS_VERSION_ID_KEY)
    if heuristics_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Heuristics version not found")
    return JSONResponse(status_code=200, content={"heuristics_version_id": heuristics_version_id.decode('utf-8')})


#####
# API Endpoints for debugging
#####
@app.post("/v1/graph/ontology/agent/debug/process")
async def process_entity(entity_type: str, primary_key_value: str):
    """
    Asks the agent to process a specific entity for heuristics, this is used for debugging
    For debugging purposes
    """
    logger.warning("Processing entity %s:%s for heuristics", entity_type, primary_key_value)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await agent.process(rc_manager, entity_type, primary_key_value)
    return JSONResponse(status_code=200, content={"message": "Submitted for processing"})


@app.post("/v1/graph/ontology/agent/debug/process_all")
async def process_all(background_tasks: BackgroundTasks):
    """
    Asks the agent to process all foreign key relations
    For debugging purposes
    """
    logger.warning("Processing all heuristics")
    if agent.is_processing:
        return JSONResponse(status_code=400, content={"message": "Heuristics processing is already in progress"})

    # Don't use the latest heuristics version for processing, use new one, for debugging, the latest heuristics version can be updated manually in redis
    new_heuristics_version_id = utils.get_uuid()
    rc_manager_new_version = RelationCandidateManager(agent.graph_db, agent.ontology_graph_db, agent.acceptance_threshold, agent.rejection_threshold, new_heuristics_version_id)
    background_tasks.add_task(agent.process_all, rc_manager_new_version)
    return JSONResponse(status_code=200, content={"message": "Submitted", "heuristics_version_id": new_heuristics_version_id})

@app.post("/v1/graph/ontology/agent/debug/evaluate_all")
async def evaluate_all(background_tasks: BackgroundTasks):
    """
    Asks the agent to reevaluate all heuristics
    For debugging purposes
    """
    logger.warning("Re-evaluating all heuristics")
    if agent.is_processing:
        return JSONResponse(status_code=400, content={"message": "Heuristics processing is in progress"})
    rc_manager = await get_rc_manager_with_latest_heuristics()
    background_tasks.add_task(agent.evaluate_all, rc_manager)
    return JSONResponse(status_code=200, content={"message": "Submitted"})


@app.post("/v1/graph/ontology/agent/debug/cleanup")
async def cleanup():
    """
    Cleans up old relations candidates that are not part of current heuristics version
    For debugging purposes
    """
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await rc_manager.cleanup() # This will remove all relations that are no longer candidates, as well as applied relations
    return JSONResponse(status_code=200, content={"message": "Submitted"})

#####
# Health endpoint
#####
@app.get("/v1/graph/ontology/agent/status")
async def status():
    return {"status": "ok", 
            "is_processing": agent.is_processing,
            "processing_tasks_total": agent.processing_tasks_total,
            "processed_tasks_count": agent.processed_tasks_count,
            "is_evaluating": agent.is_evaluating,
            "evaluation_tasks_total": agent.evaluation_tasks_total,
            "evaluated_tasks_count": agent.evaluated_tasks_count,
            "candidate_acceptance_threshold": ACCEPTANCE_THRESHOLD, 
            "candidate_rejection_threshold": REJECTION_THRESHOLD, 
            "max_concurrent_processing": MAX_CONCURRENT_PROCESSING,
            "max_concurrent_evaluation": MAX_CONCURRENT_EVALUATION,
            "min_count_for_eval": MIN_COUNT_FOR_EVAL,   
            "count_change_threshold_ratio": COUNT_CHANGE_THRESHOLD_RATIO,}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=port)
