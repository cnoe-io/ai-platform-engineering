import os
from contextlib import asynccontextmanager

from agent_ontology.agent import OntologyAgent, RelationCandidateManager 
from common.graph_db.base import GraphDB
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from common import constants, utils
from common.graph_db.neo4j.graph_db import Neo4jDB
from common.models.ontology import FkeyEvaluationResult
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
MIN_COUNT_FOR_EVAL = int(os.getenv('MIN_COUNT_FOR_EVAL', int(3))) # 3 by default
COUNT_CHANGE_THRESHOLD_RATIO = float(os.getenv('COUNT_CHANGE_THRESHOLD_RATIO', float(0.1))) # 10% by default
MAX_CONCURRENT_PROCESSING = int(os.getenv('MAX_CONCURRENT_PROCESSING', int(40))) # 40 by default
MAX_CONCURRENT_EVALUATION = int(os.getenv('MAX_CONCURRENT_EVALUATION', int(10))) # 10 by default
AGENT_RECURSION_LIMIT = int(os.getenv('AGENT_RECURSION_LIMIT', int(10))) # 10 by default

scheduler = AsyncIOScheduler()

# Initialize dependencies
logger.info("Initializing data graph database...")
graph_db: GraphDB = Neo4jDB()

logger.info("Initializing ontology graph database...")
ontology_graph_db: GraphDB = Neo4jDB(uri=os.getenv("NEO4J_ONTOLOGY_ADDR", "bolt://localhost:7688"))

logger.info("Initializing key-value store...")
redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

logger.info("Initializing ontology agent...")
logger.info("Config:\nMax concurrent processing: %s\nMax concurrent evaluation: %s\nCount change threshold ratio: %s\nMin count for eval: %s", 
            MAX_CONCURRENT_PROCESSING, MAX_CONCURRENT_EVALUATION, COUNT_CHANGE_THRESHOLD_RATIO, MIN_COUNT_FOR_EVAL)
agent: OntologyAgent = OntologyAgent(graph_db=graph_db,
                                        ontology_graph_db=ontology_graph_db,
                                        redis=redis_client,
                                        min_count_for_eval=MIN_COUNT_FOR_EVAL,
                                        count_change_threshold_ratio=COUNT_CHANGE_THRESHOLD_RATIO,
                                        max_concurrent_processing=MAX_CONCURRENT_PROCESSING,
                                        max_concurrent_evaluation=MAX_CONCURRENT_EVALUATION,
                                        agent_recursion_limit=AGENT_RECURSION_LIMIT
                                    )

@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Setting up key-value store with ontology version")

    # Fetch latest ontology version
    ontology_version_id = await redis_client.get(constants.KV_ONTOLOGY_VERSION_ID_KEY)
    if ontology_version_id is None: # if no ontology version is found, create one
        ontology_version_id = utils.get_uuid()
        await redis_client.set(constants.KV_ONTOLOGY_VERSION_ID_KEY, ontology_version_id)

    logger.info("Running the ontology agent periodically every %s seconds ...", SYNC_INTERVAL)
    scheduler.add_job(agent.process_and_evaluate_all, trigger=IntervalTrigger(seconds=SYNC_INTERVAL))
    scheduler.start()
    
    # Yield control to the event loop to allow server to start
    yield

app = FastAPI(title="Ontology Agent Admin Server", lifespan=lifespan)

async def get_rc_manager_with_latest_ontology() -> RelationCandidateManager:
    ontology_version_id = await redis_client.get(constants.KV_ONTOLOGY_VERSION_ID_KEY)
    if ontology_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Ontology version not found")
    return RelationCandidateManager(graph_db, ontology_graph_db, ontology_version_id.decode('utf-8'), agent.agent_name)

#####
# API Endpoints for manual relation management
#####
@app.post("/v1/graph/ontology/agent/relation/accept/{relation_id:path}")
async def accept_relation(relation_id: str, relation_name: str):
    """
    Accepts a foreign key relation
    """
    logger.warning("Accepting foreign key relation %s", relation_id)
    if agent.is_evaluating or agent.is_processing:
        return JSONResponse(status_code=400, content={"message": "Ontology processing/evaluation is in progress"})

    rc_manager = await get_rc_manager_with_latest_ontology()

    # Fetch the candidate
    candidate = await rc_manager.fetch_candidate(relation_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail=f"Relation candidate {relation_id} not found")

    # check if an evaluation already exists
    if candidate.evaluation is not None:
        raise HTTPException(status_code=400, detail=f"Relation candidate {relation_id} already has an evaluation, you must undo it first before accepting")

    # update the evaluation
    await rc_manager.update_evaluation(
        relation_id=relation_id,
        relation_name=relation_name,
        result=FkeyEvaluationResult.ACCEPTED,
        justification="Manually accepted by user",
        thought="Manually accepted by user",
        is_manual=True
    )

    # sync the relation
    await rc_manager.sync_relation(relation_id)

    return JSONResponse(status_code=200, content={"message": "Relation accepted"})

@app.post("/v1/graph/ontology/agent/relation/reject/{relation_id:path}")
async def reject_relation(relation_id: str):
    """
    Reject a foreign key relation
    """
    logger.warning("Rejecting foreign key relation %s", relation_id)
    if agent.is_evaluating or agent.is_processing:
        return JSONResponse(status_code=400, content={"message": "Ontology processing/evaluation is in progress"})
    rc_manager = await get_rc_manager_with_latest_ontology()

    # Fetch the candidate
    candidate = await rc_manager.fetch_candidate(relation_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail=f"Relation candidate {relation_id} not found")

    # check if an evaluation already exists
    if candidate.evaluation is not None:
        raise HTTPException(status_code=400, detail=f"Relation candidate {relation_id} already has an evaluation, you must undo it first before rejecting")

    # Update the evaluation
    await rc_manager.update_evaluation(
        relation_id=relation_id,
        relation_name=rc_manager.generate_placeholder_relation_name(relation_id),
        result=FkeyEvaluationResult.REJECTED,
        justification="Manually rejected by user",
        thought="Manually rejected by user",
        is_manual=True,
    )

    # sync the relation
    await rc_manager.sync_relation(relation_id)
    return JSONResponse(status_code=200, content={"message": "Relation rejected"})

@app.post("/v1/graph/ontology/agent/relation/undo_evaluation/{relation_id:path}")
async def undo_evaluation(relation_id: str):
    """
    Undo an accepted or rejected foreign key relation
    """
    logger.warning("Un-rejecting foreign key relation %s", relation_id)
    if agent.is_evaluating or agent.is_processing:
        return JSONResponse(status_code=400, content={"message": "Ontology processing/evaluation is in progress"})

    rc_manager = await get_rc_manager_with_latest_ontology()

    # Remove the evaluation
    await rc_manager.remove_evaluation(relation_id)

    # Sync the relation
    await rc_manager.sync_relation(relation_id)
    return JSONResponse(status_code=200, content={"message": "Evaluation undone"})

@app.post("/v1/graph/ontology/agent/relation/evaluate/{relation_id:path}")
async def evaluate_relation(relation_id: str):
    """
    Asks the agent to reevaluate a single foreign key relation
    """
    logger.warning("Re-evaluating foreign key relation %s", relation_id)
    if agent.is_evaluating or agent.is_processing:
        return JSONResponse(status_code=400, content={"message": "Ontology processing/evaluation is in progress"})
    rc_manager = await get_rc_manager_with_latest_ontology()
    await agent.evaluate(logger, rc_manager=rc_manager, relation_id=relation_id)
    await rc_manager.sync_relation(relation_id)
    return JSONResponse(status_code=200, content={"message": "Submitted"})


@app.post("/v1/graph/ontology/agent/relation/sync/{relation_id:path}")
async def sync_relation(relation_id: str):
    """
    Syncs a single foreign key relation with the graph database
    """
    logger.warning("Syncing foreign key relation %s", relation_id)
    if agent.is_evaluating or agent.is_processing:
        return JSONResponse(status_code=400, content={"message": "Ontology processing/evaluation is in progress"})
    rc_manager = await get_rc_manager_with_latest_ontology()
    await rc_manager.sync_relation(relation_id)
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
        return JSONResponse(status_code=400, content={"message": "Ontology processing is in progress"})
    ontology_version_id = await redis_client.get(constants.KV_ONTOLOGY_VERSION_ID_KEY)
    if ontology_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Ontology version not found")
    ontology_version_id = ontology_version_id.decode('utf-8')
    await agent.ontology_graph_db.remove_relation(None, {constants.ONTOLOGY_VERSION_ID_KEY: ontology_version_id})
    await agent.ontology_graph_db.remove_entity(None, {constants.ONTOLOGY_VERSION_ID_KEY: ontology_version_id})
    return JSONResponse(status_code=200, content={"message": "Cleared"})

@app.get("/v1/graph/ontology/agent/ontology_version")
async def get_ontology_version():
    ontology_version_id = await redis_client.get(constants.KV_ONTOLOGY_VERSION_ID_KEY)
    if ontology_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Ontology version not found")
    return JSONResponse(status_code=200, content={"ontology_version_id": ontology_version_id.decode('utf-8')})


#### 
# Endpoints for debugging
####
@app.post("/v1/graph/ontology/agent/debug/process_all")
async def process_all():
    """
    Asks the agent to process all entities for heuristics, this is used for debugging
    For debugging purposes
    """
    logger.warning("Processing all entities for heuristics")
    rc_manager = await get_rc_manager_with_latest_ontology()
    await agent.process_all(rc_manager)
    return JSONResponse(status_code=200, content={"message": "Submitted for processing"})

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
    rc_manager = await get_rc_manager_with_latest_ontology()
    await agent.process(rc_manager, entity_type, primary_key_value)
    return JSONResponse(status_code=200, content={"message": "Submitted for processing"})


@app.post("/v1/graph/ontology/agent/debug/cleanup")
async def cleanup():
    """
    Cleans up old relations candidates that are not part of current heuristics version
    For debugging purposes
    """
    rc_manager = await get_rc_manager_with_latest_ontology()
    await rc_manager.cleanup() # This will remove all relations that are no longer candidates, as well as applied relations
    return JSONResponse(status_code=200, content={"message": "Submitted"})

#####
# Health and config endpoints
#####
@app.get("/v1/graph/ontology/agent/status")
async def healthz():
    return {
        "status": "healthy",
        "redis_ready": "true",
        "graph_db_ready": "true",
        "ontology_graph_db_ready": "true",
        "is_processing": agent.is_processing,
        "is_evaluating": agent.is_evaluating,
        "last_evaluation_run_timestamp": agent.last_evaluation_run_timestamp,
        "max_concurrent_processing": MAX_CONCURRENT_PROCESSING,
        "max_concurrent_evaluation": MAX_CONCURRENT_EVALUATION,
        "min_count_for_eval": MIN_COUNT_FOR_EVAL,
        "count_change_threshold_ratio": COUNT_CHANGE_THRESHOLD_RATIO,
        "sync_interval_seconds": SYNC_INTERVAL,
        "agent_recursion_limit": AGENT_RECURSION_LIMIT,
        "processing_tasks_total": agent.processing_tasks_total,
        "processed_tasks_count": agent.processed_tasks_count,
        "evaluation_tasks_total": agent.evaluation_tasks_total,
        "evaluated_tasks_count": agent.evaluated_tasks_count
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=port)
