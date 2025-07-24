import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status, Request
from fastapi.responses import JSONResponse
from fastapi.responses import HTMLResponse
from fastapi.security import APIKeyHeader
from fastapi.templating import Jinja2Templates
from core.msg_pubsub.redis.msg_pubsub import RedisPubSub
from core import utils
from core.constants import FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC
from core.graph_db.neo4j.graph_db import Neo4jDB
from core.models import Entity, Relation
from fastapi.encoders import jsonable_encoder
import dotenv

from agent_graph_gen.relation_manager import RelationCandidateManager

# Load environment variables from .env file
dotenv.load_dotenv()

logging = utils.get_logger("server")

templates = Jinja2Templates(directory=os.getenv("TEMPLATES_DIR", "templates"))

# TODO: Make the dependencies configurable at runtime
graph_db = Neo4jDB()
msg_pubsub = RedisPubSub()

api_header_scheme = APIKeyHeader(name="x-api-key")
clean_up_interval = int(os.getenv("CLEANUP_INTERVAL", 3 * 60 * 60))  # Default to 3 hours

api_keys = os.getenv("API_KEYS", "").split(",")
api_keys = [token.strip() for token in api_keys if token.strip()]  # Clean up empty tokens
if not api_keys or len(api_keys) == 0:
    logging.error("No API keys configured. Please set the API_KEYS environment variable.")
    raise ValueError("API_KEYS environment variable is not set or empty. Please set it to a comma-separated list of keys.")

loop = asyncio.get_event_loop()

async def graph_db_clean_up():
    """
    Periodically cleans up the graph database
    """
    while True:
        try:
            await graph_db.remove_stale_entities()
            # TODO: make this configurable
            # TODO: cleanup relations also
            await asyncio.sleep(clean_up_interval)
        except Exception as e:
            logging.error(f"Error cleaning up graph database: {e}")

@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.info("setting up db")
    await graph_db.setup()

    logging.info("starting periodic graph clean up task")
    loop.create_task(graph_db_clean_up())

    # Yield control to the event loop to allow server to start
    yield
    logging.info("shutting down")

async def check_localhost(request: Request):
    """
    Verifies the X-API-Token header against the configured API tokens.
    Raises HTTPException if the token is invalid.
    """
    client_host = request.client.host  # Get the client's IP address # type: ignore
    logging.info(f"Client host: {client_host} for request {request.url}")
    
    # Check if the client is localhost
    if request.url.hostname == "localhost" or request.url.hostname == "127.0.0.1":
        return {"message": "Request is coming from localhost"}
    else:
        raise HTTPException(status_code=403, detail="Access denied: Not localhost")

async def verify_token(x_api_key: str = Depends(api_header_scheme)):
    """
    Verifies the X-API-Token header against the configured API tokens.
    Raises HTTPException if the token is invalid.
    """
    if x_api_key not in api_keys:
        raise HTTPException(status_code=401, detail="X-API-Token header invalid")

app = FastAPI(lifespan=lifespan)

#####
# Graph Database endpoints
#####
@app.get("/entity_type",  dependencies=[Depends(verify_token)])
async def list_entities():
    """
    Lists all entity types in the database
    """
    e = await graph_db.get_all_entity_types()
    return JSONResponse(status_code=status.HTTP_200_OK, content=e)

@app.post("/entities/",  dependencies=[Depends(verify_token)])
async def update_entity(client_name: str, entity: Entity, fresh_until: int):
    """
    Updates an entity to the database
    """
    try:
        await graph_db.update_entity(entity=entity,
                                    client_name=client_name,
                                    fresh_until=fresh_until)
    except ValueError as ve:
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"message": str(ve)})
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Entity created/updated successfully"})

@app.get("/entity/{entity_type}",  dependencies=[Depends(verify_token)])
async def find_entity(entity_type: str, filter_by: dict[str, str]):
    """
    Gets an entity from the database
    """
    entities = await graph_db.find_entity(entity_type, filter_by)
    if len(entities) < 0:
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"message": "No entities found"})
    return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(entities))

@app.post("/relations/",  dependencies=[Depends(verify_token)])
async def update_relationship(client_name: str, relation: Relation, fresh_until: int, ignore_direction: bool=False):
    """
    Updates an entity to the database
    """
    await graph_db.update_relationship(relation,
                                       client_name=client_name,
                                       ignore_direction=ignore_direction,
                                       fresh_until=fresh_until)
    logging.debug(f"Updated relationship: {client_name}, {relation}, {fresh_until}, {ignore_direction}")
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Relation created/updated successfully"})

@app.post("/entity_type/{entity_type}/knowledge", dependencies=[Depends(verify_token)])
async def update_entity_type_knowledge(entity_type: str):
    """
    Update the knowledge of an entity type
    """
    # TODO: implement this
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Not implemented yet"})


#####
# Relation agent (foreign key) admin endpoints
# Only accessible from localhost
#####
@app.post("/admin/agent/fkey/relation/{relation_id}/accept", dependencies=[Depends(check_localhost)])
async def fkey_agent_accept(relation_id: str):
    """
    Accepts a foreign key relation
    """
    logging.info("Accepting foreign key relation %s", relation_id)
    await msg_pubsub.publish(FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC, "accept:" + relation_id)
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Foreign key relation accepted"})


@app.post("/admin/agent/fkey/relation/{relation_id}/reject", dependencies=[Depends(check_localhost)])
async def fkey_agent_reject(relation_id: str):
    """
    Reject a foreign key relation
    """
    logging.info("Rejecting foreign key relation %s", relation_id)
    await msg_pubsub.publish(FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC, "reject:" + relation_id)
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Foreign key relation rejected"})

@app.post("/admin/agent/fkey/relation/{relation_id}/un_reject", dependencies=[Depends(check_localhost)])
async def fkey_agent_unreject(relation_id: str):
    """
    Undo an accepted or rejected foreign key relation
    """
    logging.info("Un-rejecting foreign key relation %s", relation_id)
    await msg_pubsub.publish(FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC, "unreject:" + relation_id)
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Foreign key relation un-rejected"})


@app.post("/admin/agent/fkey/relation/process_evaluate_all", dependencies=[Depends(check_localhost)])
async def fkey_agent_process_evaluate_all():
    """
    Asks the agent to reevaluate all foreign key relation
    """
    logging.warning("Re-evaluating all foreign key relations")
    await msg_pubsub.publish(FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC, "process_evaluate_all")
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Submitted"})

@app.post("/admin/agent/fkey/relation/evaluate_all", dependencies=[Depends(check_localhost)])
async def fkey_agent_evaluate_all():
    """
    Asks the agent to reevaluate all foreign key relation
    """
    logging.warning("Re-evaluating all foreign key relations")
    await msg_pubsub.publish(FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC, "evaluate_all")
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Submitted"})

@app.post("/admin/agent/fkey/heuristics/process_all", dependencies=[Depends(check_localhost)])
async def fkey_agent_process_all():
    """
    Asks the agent to reevaluate all foreign key relation
    """
    logging.warning("Processing all heuristics")
    await msg_pubsub.publish(FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC, "process_all")
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Submitted"})

@app.post("/admin/agent/fkey/relation/{relation_id}/evaluate", dependencies=[Depends(check_localhost)])
async def fkey_agent_evaluate(relation_id: str):
    """
    Asks the agent to reevaluate a foreign key relation
    """
    logging.info("Re-evaluating foreign key relation %s", relation_id)
    await msg_pubsub.publish(FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC, f"evaluate:{relation_id}")
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Submitted"})


@app.post("/admin/agent/fkey/relation/process",  dependencies=[Depends(check_localhost)])
async def fkey_agent_process_entity(entity_type: str, primary_key_value: str):
    """
    Asks the agent to process a specific entity for foreign key relations
    """
    logging.info("Processing entity %s:%s for foreign key relations", entity_type, primary_key_value)
    await msg_pubsub.publish(FKEY_AGENT_EVAL_REQ_PUBSUB_TOPIC, f"process:{entity_type},{primary_key_value}")
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Submitted for processing"})


#####
# Health, status and UI endpoints
#####
@app.get("/admin", response_class=HTMLResponse, dependencies=[Depends(check_localhost)])
async def admin_panel(request: Request):
    
    # TODO: Get these from the agent itself
    ACCEPTANCE_THRESHOLD = float(os.getenv('ACCEPTANCE_THRESHOLD', float(0.75))) # > 75% by default
    REJECTION_THRESHOLD = float(os.getenv('REJECTION_THRESHOLD', float(0.3))) # < 40% by default
    MIN_COUNT_FOR_EVAL = int(os.getenv('MIN_COUNT_FOR_EVAL', int(3))) # 3 by default
    rc_manager = RelationCandidateManager(graph_db, ACCEPTANCE_THRESHOLD, REJECTION_THRESHOLD)
    return templates.TemplateResponse(
        request=request, name="admin_panel.jinja2", context={
            "reject_endpoint": "/agent/fkey/relation/{relation_id}/reject",
            "un_reject_endpoint": "/agent/fkey/relation/{relation_id}/un_reject",
            "accept_endpoint": "/agent/fkey/relation/{relation_id}/accept",
            "evaluate_endpoint": "/agent/fkey/relation/{relation_id}/evaluate",
            "process_evaluate_all_endpoint": "/agent/fkey/relation/process_evaluate_all",
            "evaluate_all_endpoint": "/agent/fkey/relation/evaluate_all",
            "process_all_endpoint": "/agent/fkey/heuristics/process_all",
            "relations": dict(sorted((await rc_manager.fetch_all_candidates()).items(), key=lambda x: x[1].heuristic.count, reverse=True)),
            "graph_db_type": "neo4j",
            "graph_db_url": graph_db.uri,
            "entity_type_count": len(await graph_db.get_all_entity_types()),
            "ACCEPTANCE_THRESHOLD": ACCEPTANCE_THRESHOLD,
            "REJECTION_THRESHOLD": REJECTION_THRESHOLD,
            "MIN_COUNT_FOR_EVAL": MIN_COUNT_FOR_EVAL,
        }
    )

@app.get("/healthz")
async def healthz():
  return {"status": "ok"}
