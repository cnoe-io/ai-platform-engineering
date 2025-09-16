import os
from contextlib import asynccontextmanager

from agent_graph_gen.agent import OntologyAgent, RelationCandidateManager
from core.graph_db.base import GraphDB
from core.key_value.base import KVStore
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from core import constants, utils
from core.graph_db.neo4j.graph_db import Neo4jDB
from core.key_value.redis import RedisKVStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import dotenv
import uvicorn
import logging_tree

port = int(os.getenv("SERVER_PORT", 8095))

# Load environment variables from .env file
dotenv.load_dotenv()

logging = utils.get_logger("rest-server")

SYNC_INTERVAL = int(os.getenv('SYNC_INTERVAL', 21600)) # 6 hours by default
ACCEPTANCE_THRESHOLD = float(os.getenv('ACCEPTANCE_THRESHOLD', float(0.75))) # > 75% by default
REJECTION_THRESHOLD = float(os.getenv('REJECTION_THRESHOLD', float(0.3))) # < 40% by default
MIN_COUNT_FOR_EVAL = int(os.getenv('MIN_COUNT_FOR_EVAL', int(3))) # 3 by default
PERCENT_CHANGE_FOR_EVAL = float(os.getenv('PERCENT_CHANGE_FOR_EVAL', float(0.1))) # 10% by default
MAX_CONCURRENT_PROCESSING = int(os.getenv('MAX_CONCURRENT_PROCESSING', int(30))) # 30 by default
MAX_CONCURRENT_EVALUATION = int(os.getenv('MAX_CONCURRENT_EVALUATION', int(5))) # 5 by default

scheduler = AsyncIOScheduler()

# Initialize dependencies
logging.info("Initializing data graph database...")
graph_db: GraphDB = Neo4jDB()

logging.info("Initializing ontology graph database...")
ontology_graph_db: GraphDB = Neo4jDB(uri=os.getenv("NEO4J_ONTOLOGY_ADDR", "bolt://localhost:7688"))

logging.info("Initializing key-value store...")
kv_store: KVStore = RedisKVStore()

logging.info("Initializing ontology agent...")
agent: OntologyAgent = OntologyAgent(graph_db=graph_db,
                                        ontology_graph_db=ontology_graph_db,
                                        kv_store=kv_store,
                                        acceptance_threshold=ACCEPTANCE_THRESHOLD,
                                        rejection_threshold=REJECTION_THRESHOLD,
                                        min_count_for_eval=MIN_COUNT_FOR_EVAL,
                                        percent_change_for_eval=PERCENT_CHANGE_FOR_EVAL,
                                        max_concurrent_processing=MAX_CONCURRENT_PROCESSING,
                                        max_concurrent_evaluation=MAX_CONCURRENT_EVALUATION,
                                    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.info("Setting up ontology graph database")
    await ontology_graph_db.setup()

    logging.info("Setting up key-value store with heuristics version")
    
    # Fetch latest heuristics version
    heuristics_version_id = await kv_store.get(constants.KV_HEURISTICS_VERSION_ID_KEY)
    if heuristics_version_id is None: # if no heuristics version is found, create one
        heuristics_version_id = utils.get_uuid()
        await kv_store.put(constants.KV_HEURISTICS_VERSION_ID_KEY, heuristics_version_id)

    logging.info("Running the ontology agent periodically every %s seconds ...", SYNC_INTERVAL)
    scheduler.add_job(agent.process_and_evaluate_all, trigger=IntervalTrigger(seconds=SYNC_INTERVAL))
    scheduler.start()
    
    logging_tree.printout()
    
    # Yield control to the event loop to allow server to start
    yield

app = FastAPI(title="Ontology Agent Admin Server", lifespan=lifespan)

async def get_rc_manager_with_latest_heuristics() -> RelationCandidateManager:
    heuristics_version_id = await kv_store.get(constants.KV_HEURISTICS_VERSION_ID_KEY)
    if heuristics_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Heuristics version not found")
    return RelationCandidateManager(graph_db, ontology_graph_db, ACCEPTANCE_THRESHOLD, REJECTION_THRESHOLD, heuristics_version_id)
    
#####
# API Endpoints for manual relation management
#####
@app.post("/relation/accept/{relation_id:path}")
async def accept_relation(relation_id: str):
    """
    Accepts a foreign key relation
    """
    logging.warning("Accepting foreign key relation %s", relation_id)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await rc_manager.apply_relation("web", relation_id, manual=True)
    
    return JSONResponse(status_code=200, content={"message": "Foreign key relation accepted"})

@app.post("/relation/reject/{relation_id:path}")
async def reject_relation(relation_id: str):
    """
    Reject a foreign key relation
    """
    logging.warning("Rejecting foreign key relation %s", relation_id)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await rc_manager.unapply_relation(relation_id, manual=True) # setting manual=True will explicitly reject the relation
    return JSONResponse(status_code=200, content={"message": "Foreign key relation rejected"})

@app.post("/relation/un_reject/{relation_id:path}")
async def unreject_relation(relation_id: str):
    """
    Undo an accepted or rejected foreign key relation
    """
    logging.warning("Un-rejecting foreign key relation %s", relation_id)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await rc_manager.unapply_relation(relation_id) # manual=False by default, so it will be undone without explicitly rejecting
    return JSONResponse(status_code=200, content={"message": "Foreign key relation un-rejected"})

@app.post("/relation/evaluate/{relation_id:path}")
async def evaluate_relation(relation_id: str):
    """
    Asks the agent to reevaluate a single foreign key relation
    """
    logging.warning("Re-evaluating foreign key relation %s", relation_id)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await agent.evaluate(rc_manager=rc_manager, relation_id=relation_id)
    return JSONResponse(status_code=200, content={"message": "Submitted"})


@app.post("/relation/sync/{relation_id:path}")
async def sync_relation(relation_id: str):
    """
    Syncs a single foreign key relation with the graph database
    """
    logging.warning("Syncing foreign key relation %s", relation_id)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await rc_manager.sync_relation("web", relation_id)
    return JSONResponse(status_code=200, content={"message": "Submitted"})

@app.get("/heuristics_version")
async def get_heuristics_version():
    heuristics_version_id = await kv_store.get(constants.KV_HEURISTICS_VERSION_ID_KEY)
    if heuristics_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Heuristics version not found")
    return JSONResponse(status_code=200, content={"heuristics_version_id": heuristics_version_id})


#####
# API Endpoints for debugging
#####
@app.post("/debug/process")
async def process_entity(entity_type: str, primary_key_value: str):
    """
    Asks the agent to process a specific entity for heuristics, this is used for debugging
    For debugging purposes
    """
    logging.warning("Processing entity %s:%s for heuristics", entity_type, primary_key_value)
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await agent.process(rc_manager, entity_type, primary_key_value)
    return JSONResponse(status_code=200, content={"message": "Submitted for processing"})


@app.post("/debug/process_all")
async def process_all(background_tasks: BackgroundTasks):
    """
    Asks the agent to process all foreign key relations
    For debugging purposes
    """
    logging.warning("Processing all heuristics")
    if agent.is_processing:
        return JSONResponse(status_code=400, content={"message": "Heuristics processing is already in progress"})

    # Don't use the latest heuristics version for processing, use new one, for debugging, the latest heuristics version can be updated manually in redis
    new_heuristics_version_id = utils.get_uuid()
    rc_manager_new_version = RelationCandidateManager(agent.graph_db, agent.ontology_graph_db, agent.acceptance_threshold, agent.rejection_threshold, new_heuristics_version_id)
    background_tasks.add_task(agent.process_all, rc_manager_new_version)
    return JSONResponse(status_code=200, content={"message": "Submitted", "heuristics_version_id": new_heuristics_version_id})

@app.post("/debug/evaluate_all")
async def evaluate_all(background_tasks: BackgroundTasks):
    """
    Asks the agent to reevaluate all heuristics
    For debugging purposes
    """
    logging.warning("Re-evaluating all heuristics")
    if agent.is_processing:
        return JSONResponse(status_code=400, content={"message": "Heuristics processing is in progress"})
    rc_manager = await get_rc_manager_with_latest_heuristics()
    background_tasks.add_task(agent.evaluate_all, rc_manager)
    return JSONResponse(status_code=200, content={"message": "Submitted"})

@app.post("/debug/process_evaluate_all")
async def process_evaluate_all(background_tasks: BackgroundTasks):
    """
    Asks the agent to reevaluate all heuristics
    """
    logging.warning("Processing and Evaluating all heuristics")
    if agent.is_processing:
        return JSONResponse(status_code=400, content={"message": "Heuristics processing is in progress"})
    background_tasks.add_task(agent.process_and_evaluate_all)
    return JSONResponse(status_code=200, content={"message": "Submitted"})

@app.post("/debug/cleanup")
async def cleanup():
    """
    Cleans up old relations candidates that are not part of current heuristics version
    For debugging purposes
    """
    rc_manager = await get_rc_manager_with_latest_heuristics()
    await rc_manager.cleanup() # This will remove all relations that are no longer candidates, but still exist in the graph database
    return JSONResponse(status_code=200, content={"message": "Submitted"})

#####
# Health endpoint
#####
@app.get("/healthz")
async def healthz():
    return {"status": "ok", "service": "agent_admin_server"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=port)
