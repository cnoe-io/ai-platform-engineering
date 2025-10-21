from contextlib import asynccontextmanager
import datetime
import traceback
import uuid
from common import utils
from fastapi import FastAPI, status, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastmcp import FastMCP
from server.tools import AgentTools
from server.loader.loader import Loader
from starlette.requests import Request
from starlette.responses import StreamingResponse
from starlette.background import BackgroundTask
from typing import List, Optional
import logging
from langchain_core.documents import Document
from server.metadata_storage import MetadataStorage
from common.job_manager import JobManager, JobStatus
from server.models import ExploreDataEntityRequest, ExploreEntityRequest, ExploreRelationsRequest, QueryRequest, IngestResponse, QueryResults, UrlIngest, FileIngest, EntityIngest
from common.models.rag import DataSourceInfo, GraphConnectorInfo, VectorDBGraphMetadata, DocTypeGraphEntity, doc_types, valid_metadata_keys
from common.models.graph import Entity
from common.graph_db.neo4j.graph_db import Neo4jDB
from common.graph_db.base import GraphDB
from common.constants import HEURISTICS_VERSION_ID_KEY, KV_HEURISTICS_VERSION_ID_KEY, UPDATED_BY_KEY
import redis.asyncio as redis
from langchain_openai import AzureOpenAIEmbeddings
from langchain_milvus import BM25BuiltInFunction, Milvus
from pymilvus import MilvusClient
import os
import httpx
from server.query_service import VectorDBQueryService
from langchain.globals import set_verbose as set_langchain_verbose

metadata_storage: Optional[MetadataStorage] = None
vector_db: Optional[Milvus] = None
jobmanager: Optional[JobManager] = None
data_graph_db: Optional[GraphDB] = None
ontology_graph_db: Optional[GraphDB] = None

# Initialize logger
logger = utils.get_logger(__name__)
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))
print(f"LOG LEVEL set to {str(logger.level)}")
if logger.level == logging.DEBUG: # enable langchain verbose logging
    set_langchain_verbose(True)

# Read configuration from environment variables
clean_up_interval = int(os.getenv("CLEANUP_INTERVAL", 3 * 60 * 60))  # Default to 3 hours
ontology_agent_client = httpx.AsyncClient(base_url=os.getenv("ONTOLOGY_AGENT_RESTAPI_ADDR", "http://localhost:8098"))
graph_rag_enabled = os.getenv("ENABLE_GRAPH_RAG", "true").lower() in ("true", "1", "yes")
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
milvus_uri = os.getenv("MILVUS_URI", "http://localhost:19530")
embeddings_model = os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-small")
neo4j_addr = os.getenv("NEO4J_ADDR", "bolt://localhost:7687")
ontology_neo4j_addr = os.getenv("NEO4J_ONTOLOGY_ADDR", "bolt://localhost:7688")
skip_init_tests = os.getenv("SKIP_INIT_TESTS", "false").lower() in ("true", "1", "yes") # used when debugging to skip connection tests
max_ingestion_concurrency = int(os.getenv("MAX_INGESTION_CONCURRENCY", 30)) # max concurrent tasks during ingestion for one datasource
ui_url = os.getenv("UI_URL", "http://localhost:9447")
mcp_enabled = os.getenv("ENABLE_MCP", "true").lower() in ("true", "1", "yes")

default_collection_name_docs = "rag_default"
dense_index_params = {"index_type": "HNSW", "metric_type": "COSINE"}
sparse_index_params = {"index_type": "SPARSE_INVERTED_INDEX", "metric_type": "BM25"}

milvus_connection_args = {"uri": milvus_uri}


if graph_rag_enabled:
    logger.info("Graph RAG is enabled.")
else:
    logger.info("Graph RAG is disabled.")


# Application lifespan management - initalization and cleanup
@asynccontextmanager
async def app_lifespan(app: FastAPI):
    """Manage application lifespan events"""
    # Startup
    logging.info("Starting up the app...")
    logging.info("setting up dbs")

    global metadata_storage
    global jobmanager
    global data_graph_db
    global ontology_graph_db
    global vector_db
    global redis_client
    global vector_db_query_service

    redis_client = redis.from_url(redis_url)
    metadata_storage = MetadataStorage(redis_client=redis_client)
    jobmanager = JobManager(redis_client=redis_client)
    embeddings = AzureOpenAIEmbeddings(model=embeddings_model)

    if not skip_init_tests:
        # Do some inital tests to ensure the connections are all working
        await init_tests(
            logger=logger,
            redis_client=redis_client,
            embeddings=embeddings,
            milvus_uri=milvus_uri
        )

    # Setup vector db for document data
    vector_db = Milvus(
        embedding_function=embeddings,
        collection_name=default_collection_name_docs,
        connection_args=milvus_connection_args,
        index_params=[dense_index_params, sparse_index_params],
        builtin_function=BM25BuiltInFunction(output_field_names="sparse"),
        vector_field=["dense", "sparse"],
        enable_dynamic_field=True, # allow for dynamic metadata fields
    )

    vector_db_query_service = VectorDBQueryService(vector_db=vector_db)

    if graph_rag_enabled:
        # Setup graph dbs
        data_graph_db = Neo4jDB(uri=neo4j_addr)
        await data_graph_db.setup()
        ontology_graph_db = Neo4jDB(uri=ontology_neo4j_addr)
        await ontology_graph_db.setup()

    # Initialize database, cache, etc.
    yield
    # Shutdown
    logging.info("Shutting down the app...")

if mcp_enabled:
    # Initialize MCP server
    mcp = FastMCP("RAG Tools")
    mcp_app = mcp.http_app(path='/mcp')


# Combine both lifespans - App and MCP (if enabled)
@asynccontextmanager
async def combined_lifespan(app: FastAPI):
    async with app_lifespan(app):
        if not mcp_enabled:
            yield # Skip MCP setup
        else:
            # Initialize MCP server tools
            agent_tools = AgentTools(
                vector_db_query_service=vector_db_query_service,
                redis_client=redis_client,
                data_graph_db=data_graph_db,
                ontology_graph_db=ontology_graph_db,
            )

            # Add all agent tools to the MCP app
            await agent_tools.register_tools(mcp, graph_rag_enabled=graph_rag_enabled)

            # Register MCP app lifespan
            async with mcp_app.lifespan(app):
                yield


# Initialize FastAPI app
if mcp_enabled:
    app = FastAPI(
        title="CAIPE RAG API",
        description="API for indexing and querying knowledge base for CAIPE",
        version="2.0.0",
        lifespan=combined_lifespan,
        routes=[*mcp_app.routes]  # Include MCP routes
    )
else:
    app = FastAPI(
        title="CAIPE RAG API",
        description="API for indexing and querying knowledge base for CAIPE",
        version="2.0.0",
        lifespan=combined_lifespan,
    )

# ============================================================================
# Datasources Endpoints
# ============================================================================

@app.delete("/v1/datasource/delete", status_code=status.HTTP_200_OK)
async def delete_datasource(datasource_id: str):
    """Delete datasource from vector storage and metadata."""
    if not vector_db or not metadata_storage or not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    # Fetch datasource info
    datasource_info = await metadata_storage.get_datasource_info(datasource_id)
    if not datasource_info:
        raise HTTPException(status_code=404, detail="Datasource not found")

    # Check if any jobs are running for this datasource
    if datasource_info.job_id:
        job_info = await jobmanager.get_job(datasource_info.job_id)
        if job_info and job_info.status == JobStatus.IN_PROGRESS:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete datasource while ingestion job is in progress."
            )

    await vector_db.adelete(expr=f"datasource_id == '{datasource_id}'")
    await metadata_storage.delete_datasource_info(datasource_id) # remove metadata

    return status.HTTP_200_OK

@app.get("/v1/datasources")
async def list_datasources():
    """List all stored datasources"""
    if not metadata_storage:
        raise HTTPException(status_code=500, detail="Server not initialized")
    try:
        datasources = await metadata_storage.fetch_all_datasource_info()

        return {
            "success": True,
            "datasources": datasources,
            "count": len(datasources)
        }
    except Exception as e:
        logger.error(f"Failed to list datasources: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/datasource/ingest/url", response_model=IngestResponse)
async def ingest_datasource_url(
    url_ingest_request: UrlIngest,
    background_tasks: BackgroundTasks):
    """Ingest a new datasource from a URL into the unified collection."""
    if not metadata_storage or not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    logger.info(f"Ingesting datasource from URL: {url_ingest_request.url}")

    # Sanitize URL
    url_ingest_request.url = utils.sanitize_url(url_ingest_request.url)

    # Generate a deterministic datasource_id from the URL
    datasource_id = DataSourceInfo.generate_id_from_url(url_ingest_request.url)

    # Check if a datasource for this ID already exists and is being ingested
    existing_datasource = await metadata_storage.get_datasource_info(datasource_id)
    if existing_datasource and existing_datasource.job_id:
        job_info = await jobmanager.get_job(existing_datasource.job_id)
        if job_info:
            if job_info.status == JobStatus.PENDING or job_info.status == JobStatus.IN_PROGRESS:
                logger.warning(f"Ingestion for datasource {datasource_id} is already in progress with job_id {existing_datasource.job_id}.")
                raise HTTPException(
                    status_code=400,
                    detail=f"Ingestion for this datasource is already in progress (Job ID: {existing_datasource.job_id})."
                )
            else:
                logger.warning(f"Ingestion for datasource {datasource_id} is already completed with job_id {existing_datasource.job_id}.")
                raise HTTPException(
                    status_code=400,
                    detail="Ingestion for this datasource is already completed. Please delete the datasource and try again."
                )

    # Create job and update job status
    job_id = str(uuid.uuid4())
    await jobmanager.update_job(job_id, status=JobStatus.PENDING, message="Starting ingestion...")

    # Start background task
    background_tasks.add_task(
        run_url_ingestion_with_progress,
        url_ingest_request.url,
        job_id,
        url_ingest_request.description,
        url_ingest_request.default_chunk_size,
        url_ingest_request.default_chunk_overlap,
        url_ingest_request.check_for_site_map,
        url_ingest_request.sitemap_max_urls
    )

    return IngestResponse(
        job_id=job_id,
    )

@app.post("/v1/datasource/reload")
async def reload_datasource(datasource_id: str, background_tasks: BackgroundTasks):
    # Fetch the datasource
    if not metadata_storage or not vector_db or not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    datasource_info = await metadata_storage.get_datasource_info(datasource_id)
    if not datasource_info:
            raise HTTPException(status_code=404, detail="Datasource not found")

    # Re-ingest based on original source type
    if datasource_info.source_type == "web":
        # Delete the existing datasource
        await delete_datasource(datasource_id)
        url_ingest_request = UrlIngest(
            url=datasource_info.path,
            description=datasource_info.description,
            default_chunk_size=datasource_info.default_chunk_size,
            default_chunk_overlap=datasource_info.default_chunk_overlap,
            check_for_site_map=datasource_info.check_for_site_map,
            sitemap_max_urls=datasource_info.sitemap_max_urls
        )
        return await ingest_datasource_url(
            url_ingest_request,
            background_tasks
        )


@app.post("/v1/datasource/ingest/file", status_code=status.HTTP_501_NOT_IMPLEMENTED)
async def ingest_datasource_file(
    datasource: FileIngest,
    background_tasks: BackgroundTasks
):
    """Ingest a new datasource from a file."""
    # TODO: implement file ingestion
    return status.HTTP_501_NOT_IMPLEMENTED

# ============================================================================
# Job Endpoints
# ============================================================================
@app.get("/v1/job/{job_id}")
async def get_job_status(job_id: str):
    """Get the status of an ingestion job."""
    if not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    job_info = await jobmanager.get_job(job_id)
    if not job_info:
        raise HTTPException(status_code=404, detail="Job not found")

    logger.info(f"Returning job status for {job_id}: {job_info.status}")
    return {
        "job_id": job_id,
        "status": job_info.status,
        "message": job_info.message,
        "processed_counter": job_info.processed_counter,
        "failed_counter": job_info.failed_counter,
        "total": job_info.total,
        "created_at": job_info.created_at.isoformat(),
        "completed_at": job_info.completed_at.isoformat() if job_info.completed_at else None,
        "errors": job_info.errors
    }

@app.post("/v1/job/{job_id}/terminate", status_code=status.HTTP_200_OK)
async def terminate_job(job_id: str):
    """Terminate an ingestion job."""
    if not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    job_info = await jobmanager.get_job(job_id)
    if not job_info:
        raise HTTPException(status_code=404, detail="Job not found")

    if job_info.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.TERMINATED):
        raise HTTPException(status_code=400, detail="Job is already completed or terminated")

    await jobmanager.update_job(job_id, status=JobStatus.TERMINATED, message="Job has been terminated by user.")
    logger.info(f"Job {job_id} has been terminated.")
    return {"message": f"Job {job_id} has been terminated."}

# ============================================================================
# Query Endpoint
# ============================================================================

@app.post("/v1/query", response_model=QueryResults)
async def query_documents(query_request: QueryRequest):
    """Query for relevant documents using semantic search in the unified collection."""

    # If weighted ranker specified but no weights then use default weights
    if query_request.ranker_type == "weighted":
        if query_request.ranker_params is None:
            query_request.ranker_params = {"weights": [0.7, 0.3]} # More weight to dense (semantic) score

    # If no ranker specified then set ranker params to None
    if not query_request.ranker_type or query_request.ranker_type == "":
        query_request.ranker_params = None

    results = await vector_db_query_service.query(
            query=query_request.query,
            filters=query_request.filters,
            limit=query_request.limit,
            similarity_threshold=query_request.similarity_threshold,
            ranker=query_request.ranker_type,
            ranker_params=query_request.ranker_params,
    )
    return results

# ============================================================================
# Knowledge Graph Endpoints
# ============================================================================

@app.get("/v1/graph/connectors")
async def list_graph_connectors():
    """
    Lists all graph connectors in the database
    """
    if not metadata_storage:
        raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")
    logger.debug("Listing graph connectors")
    connectors = await metadata_storage.fetch_all_graphconnector_info()
    return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(connectors))

@app.delete("/v1/graph/connector/delete")
async def delete_graph_connector(connector_id: str):
    if not vector_db or not metadata_storage or not data_graph_db:
        raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")
    connector_info =  await metadata_storage.get_graphconnector_info(connector_id)

    if not connector_info:
        raise HTTPException(status_code=404, detail="Connector not found")

    logger.info(f"Deleting graph connector: {connector_id}")
    await data_graph_db.remove_entity(None, {UPDATED_BY_KEY: connector_id}) # remove from graph db
    await vector_db.adelete(expr=f"graph_connector_id == '{connector_id}'") # remove from vector db
    await metadata_storage.delete_graphconnector_info(connector_id) # remove metadata


@app.get("/v1/graph/explore/entity_type")
async def list_entity_types():
    """
    Lists all entity types in the database
    """
    if not ontology_graph_db:
        raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")
    logger.debug("Listing entity types")
    e = await ontology_graph_db.get_all_entity_types()
    return JSONResponse(status_code=status.HTTP_200_OK, content=e)

@app.post("/v1/graph/explore/data/entity")
async def explore_data_entity(explore_data_entity_request: ExploreDataEntityRequest):
    """
    Gets an entity from the database
    """
    if not data_graph_db:
        raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")
    logger.debug(f"Finding entity: {explore_data_entity_request.entity_type}, {explore_data_entity_request.entity_pk}")
    entity = await data_graph_db.fetch_entity(explore_data_entity_request.entity_type, explore_data_entity_request.entity_pk)
    relations = await data_graph_db.fetch_entity_relations(explore_data_entity_request.entity_type, explore_data_entity_request.entity_pk)
    if not entity:
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"message": "No entities found"})
    return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder({"entity": entity, "relations": relations}))

@app.post("/v1/graph/explore/ontology/entities")
async def explore_ontology_entities(explore_entity_request: ExploreEntityRequest):
    """
    Gets an entity from the database
    """
    if not ontology_graph_db:
        raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

    # Fetch the current heuristics version id
    heuristics_version_id = await redis_client.get(KV_HEURISTICS_VERSION_ID_KEY)
    if heuristics_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Heuristics version not found")
    heuristics_version_id = heuristics_version_id.decode("utf-8")

    # Add heuristics version to filter properties
    filter_by_props = explore_entity_request.filter_by_properties or {}
    filter_by_props[HEURISTICS_VERSION_ID_KEY] = heuristics_version_id

    logger.debug(f"Finding entity: {explore_entity_request.entity_type}, {filter_by_props}")

    entities = await ontology_graph_db.find_entity(explore_entity_request.entity_type, filter_by_props, max_results=1000)
    if len(entities) < 0:
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"message": "No entities found"})
    return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(entities))

@app.post("/v1/graph/explore/ontology/relations")
async def explore_ontology_relations(explore_relations_request: ExploreRelationsRequest):
    """
    Gets a relation from the database
    """
    if not ontology_graph_db:
        raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

    # Fetch the current heuristics version id
    heuristics_version_id = await redis_client.get(KV_HEURISTICS_VERSION_ID_KEY)
    if heuristics_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Heuristics version not found")
    heuristics_version_id = heuristics_version_id.decode("utf-8")

    # Add heuristics version to filter properties
    filter_by_props = explore_relations_request.filter_by_properties or {}
    filter_by_props[HEURISTICS_VERSION_ID_KEY] = heuristics_version_id

    logger.debug(f"Finding relation: {explore_relations_request.from_type}, {explore_relations_request.to_type}, {explore_relations_request.relation_name}, {filter_by_props}")
    relations = await ontology_graph_db.find_relations(explore_relations_request.from_type, explore_relations_request.to_type, explore_relations_request.relation_name, filter_by_props, max_results=1000)
    if len(relations) < 0:
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"message": "No relations found"})
    return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(relations))


@app.post("/v1/graph/ingest/entities")
async def ingest_entities(entity_ingest_request: EntityIngest, background_tasks: BackgroundTasks):
    """Updates/Ingests entities to the database"""
    if not data_graph_db or not ontology_graph_db:
        raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")
    logger.debug(f"Updating entities: {entity_ingest_request.connector_name}, type={entity_ingest_request.entity_type}, count={len(entity_ingest_request.entities)}, fresh_until={entity_ingest_request.fresh_until}")
    try:
        background_tasks.add_task(run_graph_entity_ingestion, entity_ingest_request.connector_name, entity_ingest_request.entity_type, entity_ingest_request.entities, entity_ingest_request.fresh_until)
    except ValueError as ve:
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"message": str(ve)})
    return JSONResponse(status_code=status.HTTP_200_OK, content={"message": "Entity created/updated successfully"})


async def _reverse_proxy(request: Request):
    """Reverse proxy to ontology agent service, which runs a separate FastAPI instance, and is responsible for handling ontology related requests."""
    url = httpx.URL(path=request.url.path,
                    query=request.url.query.encode("utf-8"))
    rp_req = ontology_agent_client.build_request(request.method, url,
                                  headers=request.headers.raw,
                                  content=request.stream(), timeout=30.0)
    rp_resp = await ontology_agent_client.send(rp_req, stream=True)
    return StreamingResponse(
        rp_resp.aiter_raw(),
        status_code=rp_resp.status_code,
        headers=rp_resp.headers,
        background=BackgroundTask(rp_resp.aclose),
    )

if graph_rag_enabled:
    app.add_route("/v1/graph/ontology/agent/{path:path}",
                _reverse_proxy, ["GET", "POST", "DELETE"])


# ============================================================================
# Prompt Endpoints
# ============================================================================

@app.get("/v1/utility/discovery")
async def get_rag_prompt_endpoint():
    """Get the RAG prompt template."""
    if not data_graph_db or not metadata_storage:
        logger.warning("Ontology graph db or metadata storage not initialized, or graph RAG is disabled. Returning empty prompt.")
        return ""
    available_filters = valid_metadata_keys()
    document_sources = await metadata_storage.fetch_all_datasource_info() if metadata_storage else []
    document_sources = [{"datasource_id": ds.datasource_id, "description": ds.description, "path": ds.path} for ds in document_sources]
    entities = await data_graph_db.get_all_entity_types()

    resp = {
        "graph_rag_enabled": graph_rag_enabled,
        "available_filters": available_filters,
        "document_sources": document_sources,
        "ui_url": ui_url,
    }

    if graph_rag_enabled:
        resp["entities"] = entities
        resp["graph_db_type"] = data_graph_db.database_type
        resp["graph_query_language"] = data_graph_db.query_language

    return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(resp))

# ============================================================================
# Health Check
# ============================================================================

@app.get("/healthz")
async def health_check():
    """Health check endpoint."""
    health_status = "healthy"
    health_details = {}

    # Check if services are initialized
    if not metadata_storage or \
        not vector_db or \
        not jobmanager or \
        not redis_client or \
        (graph_rag_enabled and (not data_graph_db or not ontology_graph_db)):
        health_status = "unhealthy"
        health_details["error"] = "One or more services are not initialized"
        logger.error("healthz: One or more services are not initialized")

    config = {
            "graph_rag_enabled": graph_rag_enabled,
            "search" : {
                "keys": valid_metadata_keys(),
                "supported_doc_types": doc_types
            },
            "vector_db": {
                "milvus": {
                    "uri": milvus_uri,
                    "collections": [default_collection_name_docs],
                    "index_params": {"dense": dense_index_params, "sparse": sparse_index_params}
                }
            },
            "embeddings": {
                "model": embeddings_model
            },
            "metadata_storage": {
                "redis": {
                    "url": redis_url
                }
            }
    }

    if graph_rag_enabled:
        if data_graph_db and ontology_graph_db:
            config["graph_db"] = {
                "data_graph": {
                    "type": "neo4j",
                    "uri": neo4j_addr
                },
                "ontology_graph": {
                    "type": "neo4j",
                    "uri": ontology_neo4j_addr
                }
            }

    response = {
        "status": health_status,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "details": health_details,
        "config": config
    }
    return response


# ============================================================================
# Ingest functions
# ============================================================================

async def run_url_ingestion_with_progress(url: str, job_id: str, description: str, default_chunk_size: int, default_chunk_overlap: int, check_for_site_map: bool = False, sitemap_max_urls: int = 0):
    """Function to run ingestion with proper job tracking and ID management"""
    if not vector_db or not metadata_storage or not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    try:
        # Generate the datasource id from the url
        datasource_id = DataSourceInfo.generate_id_from_url(url)
        logger.info(f"Ingesting datasource: url={url}, datasource_id={datasource_id}")

        # Get or create datasource configuration
        datasource_info = await metadata_storage.get_datasource_info(datasource_id)
        if not datasource_info:
            # Create default datasource info
            current_time = datetime.datetime.now(datetime.timezone.utc)
            datasource_info = DataSourceInfo(
                job_id=job_id,
                datasource_id=datasource_id,
                description=description,
                check_for_site_map=check_for_site_map,
                sitemap_max_urls=sitemap_max_urls,
                source_type="web",
                path=url,
                default_chunk_size=default_chunk_size,
                default_chunk_overlap=default_chunk_overlap,
                created_at=current_time,
                last_updated=current_time,
                total_documents=0,
                total_chunks=0,
                metadata={}
            )
            await metadata_storage.store_datasource_info(datasource_info)

        logger.info(f"Ingesting datasource: datasource_id={datasource_id}")
        logger.debug(f"Datasource info: {datasource_info.model_dump()}")

        # Create a new loader and run ingestion
        logger.debug(f"Creating loader for datasource: datasource_id={datasource_id}")
        async with Loader(vector_db, metadata_storage, datasource_info, jobmanager, max_ingestion_concurrency) as loader:
            await loader.load_url(url, job_id, check_for_site_map, sitemap_max_urls)

        # Update source statistics after ingestion
        await metadata_storage.update_source_stats(datasource_id)

    except Exception as e:
        logger.error(traceback.format_exc())
        logger.error(f"Ingestion failed for job {job_id}: {e}")
        await jobmanager.update_job(job_id, status=JobStatus.FAILED, message="Error ingesting data", errors=[f"Error ingesting data: {e}"])

async def run_graph_entity_ingestion(connector_name: str, entity_type: str, entities: List[Entity], fresh_until: int):
    """Function to ingest a graph entity"""
    if not vector_db or not metadata_storage or not ontology_graph_db or not data_graph_db:
        raise HTTPException(status_code=500, detail="Server not initialized")
    connector_id = connector_name
    current_time = datetime.datetime.now(datetime.timezone.utc)

    documents : List[Document] = []
    ids : List[str] = []
    for entity in entities:
        entity_hash = entity.get_hash()
        primary_key = entity.generate_primary_key()

        # Check if the entity with the same primary key already exists
        try:
            existing_data = await vector_db.aget_by_ids([primary_key])
            if existing_data:
                # If it exists, check the hash
                if existing_data[0].metadata.get("hash") == entity_hash:
                    logger.debug(f"Entity {primary_key} has not changed. Skipping ingestion.")
                    return
        except Exception:
            # If aget fails, it's likely because the document doesn't exist, so we can proceed
            pass

        # Create a document from the entity properties
        entity_properties = entity.get_external_properties()
        entity_properties["entity_type"] = entity.entity_type
        entity_text = utils.json_encode(entity_properties)
        global_id = f"{entity_type}_{primary_key}" # create a global id for the entity document which includes the entity type
        document = Document(
            page_content=entity_text,
            metadata=VectorDBGraphMetadata(
                doc_type=DocTypeGraphEntity,
                chunk_index=0,
                total_chunks=1,
                datasource_id=connector_id, # use connector_id as datasource_id
                id=global_id,
                graph_entity_hash=entity_hash,
                graph_connector_id=connector_id,
                graph_entity_type=entity.entity_type,
                graph_entity_primary_key=primary_key
            ).model_dump()
        )
        documents.append(document)
        ids.append(primary_key)

    # Add the document to the vector database
    await vector_db.aadd_documents(documents, ids=ids)
    logger.info(f"Successfully ingested {len(entities)} entities into the vector database.")

    # Update data graph with the new entities
    await data_graph_db.update_entity(entity_type, entities, fresh_until=fresh_until, client_name=connector_name)

    # Get or create graph connector configuration
    connector_info = await metadata_storage.get_graphconnector_info(connector_id)
    if not connector_info:
        # Create default graph connector info
        connector_info = GraphConnectorInfo(
            connector_id=connector_id,
            name=connector_name,
            description=f"Graph connector for {connector_name}",
            last_seen=current_time,
        )
    else:
        # Update last_seen timestamp
        connector_info.last_seen = current_time

    await metadata_storage.store_graphconnector_info(connector_info, ttl=utils.DURATION_DAY)


async def init_tests(logger: logging.Logger,
               redis_client: redis.Redis,
               embeddings: AzureOpenAIEmbeddings,
               milvus_uri: str):
    """
    Run initial tests to ensure connections to check if deps are working.
    Note: This does not check the graph db connection as its done in the init of the class.
    """
    logger.info("====== Running initialization tests ======")
    logger.info(f"1. Testing connections to Redis: URI [{redis_url}]...")
    resp = await redis_client.ping()
    logger.info(f"Redis ping response: {resp}")

    # Test embeddings endpoint
    logger.info(f"2. Testing connections to Azure OpenAI embeddings [{embeddings_model}]...")
    resp = embeddings.embed_documents(["Test document"])
    logger.info(f"Azure OpenAI embeddings response: {resp}")

    # Test vector DB connections
    logger.info(f"3. Testing connections to Milvus: [{milvus_uri}]...")
    client = MilvusClient(uri=milvus_uri)
    logger.info("4. Listing Milvus collections")
    collections = client.list_collections()
    logger.info(f"Milvus collections: {collections}")

    test_collection_name = "test_collection"

    # Setup vector db for graph data
    vector_db_test = Milvus(
        embedding_function=embeddings,
        collection_name=test_collection_name,
        connection_args=milvus_connection_args,
        index_params=[dense_index_params, sparse_index_params],
        builtin_function=BM25BuiltInFunction(output_field_names="sparse"),
        vector_field=["dense", "sparse"]
    )

    doc = Document(page_content="Test document", metadata={"source": "test"})
    logger.info(f"5. Adding test document to Milvus {doc}")
    resp = vector_db_test.add_documents(documents=[doc], ids=["test_doc_1"])
    logger.info(f"Milvus add response: {resp}")

    logger.info("6. Searching test document in Milvus")
    docs_with_score = vector_db_test.similarity_search_with_score("Test", k=1)
    logger.info(f"Milvus similarity search response: {docs_with_score}")

    logger.info(f"7. Listing Milvus collections (again, should see {test_collection_name})")
    collections = client.list_collections()
    logger.info(f"Milvus collections: {collections}")

    logger.info(f"8. Dropping {test_collection_name} collection in Milvus")
    resp = client.drop_collection(collection_name=test_collection_name)
    logger.info(f"Milvus drop collection response: {resp}")

    logger.info(f"9. Listing Milvus collections (final - should not see {test_collection_name})")
    collections = client.list_collections()
    logger.info(f"Milvus collections: {collections}")

    # Enhanced health checks for collections
    logger.info("10. Running enhanced health checks on collections...")

    # Get embedding dimensions for validation
    test_embedding = embeddings.embed_documents(["test"])
    expected_dim = len(test_embedding[0])
    logger.info(f"Expected embedding dimension: {expected_dim}")

    collections_to_check = [default_collection_name_docs]

    for collection_name in collections_to_check:
        logger.info(f"11. Validating collection {collection_name} in Milvus")

        # Check if collection exists
        if collection_name not in client.list_collections():
            logger.warning(f"Collection {collection_name} does not exist in Milvus, it should be created upon first ingestion.")
            continue

        # Get collection schema
        collection_info = client.describe_collection(collection_name=collection_name)
        logger.info(f"Collection {collection_name} info: {collection_info}")

        # Extract field information
        fields = collection_info.get('fields', [])
        field_names = {field['name'] for field in fields}

        # Check 1: Validate embedding dimensions
        logger.info(f"11a. Validating embedding dimensions for collection {collection_name}...")
        dense_field = next((field for field in fields if field['name'] == 'dense'), None)
        if dense_field:
            actual_dim = dense_field['params'].get('dim')
            if actual_dim != expected_dim:
                raise Exception(f"Collection {collection_name}: Dense vector dimension mismatch. Expected: {expected_dim}, Actual: {actual_dim}, Have you changed the embeddings model? Please delete and re-ingest the collection.")
            logger.info(f"✓ Collection {collection_name}: Dense vector dimension correct ({actual_dim})")
        else:
            raise Exception(f"Collection {collection_name}: Dense vector field not found, please delete and re-ingest the collection.")

        # Check 2: Validate vector fields exists
        logger.info(f"11b. Validating vector fields for collection {collection_name}...")
        sparse_field = next((field for field in fields if field['name'] == 'sparse'), None)
        if not sparse_field:
            raise Exception(f"Collection {collection_name}: Sparse vector field not found")

        # Validate required vector fields exist
        if 'dense' not in field_names or 'sparse' not in field_names:
            raise Exception(f"Collection {collection_name}: Missing required vector fields (dense, sparse), please delete and re-ingest the collection.")
        logger.info(f"✓ Collection {collection_name}: Vector fields present")

        if not collection_info.get("enable_dynamic_field"):
            raise Exception(f"Collection {collection_name}: Dynamic fields not enabled, please delete and re-ingest the collection.")

        logger.info(f"✓ Collection {collection_name}: Dynamic fields enabled")
        logger.info(f"✓ Collection {collection_name}: Metadata fields will be stored dynamically")

    logger.info("====== Initialization tests completed successfully ======")
    return