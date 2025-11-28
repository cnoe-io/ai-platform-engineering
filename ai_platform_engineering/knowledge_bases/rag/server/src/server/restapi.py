from contextlib import asynccontextmanager
import hashlib
import traceback
import uuid
from common import utils
from fastapi import FastAPI, status, HTTPException
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastmcp import FastMCP
from server.tools import AgentTools
from starlette.requests import Request
from starlette.responses import StreamingResponse
from starlette.background import BackgroundTask
from typing import List, Optional
import logging
from langchain_core.documents import Document
from common.metadata_storage import MetadataStorage
from common.job_manager import JobManager, JobStatus
from common.models.server import ExploreDataEntityRequest, ExploreEntityRequest, ExploreRelationsRequest, QueryRequest, QueryResult, DocumentIngestRequest, IngestorPingRequest, IngestorPingResponse, UrlIngestRequest, IngestorRequest, WebIngestorCommand, UrlReloadRequest
from common.models.rag import DataSourceInfo, IngestorInfo, valid_metadata_keys
from common.graph_db.neo4j.graph_db import Neo4jDB
from common.graph_db.base import GraphDB
from common.constants import ONTOLOGY_VERSION_ID_KEY, KV_ONTOLOGY_VERSION_ID_KEY, INGESTOR_ID_KEY, DATASOURCE_ID_KEY, WEBLOADER_INGESTOR_REDIS_QUEUE, WEBLOADER_INGESTOR_NAME, WEBLOADER_INGESTOR_TYPE
import redis.asyncio as redis
from langchain_openai import AzureOpenAIEmbeddings
from langchain_milvus import BM25BuiltInFunction, Milvus
from pymilvus import MilvusClient
import time
import os
import httpx
from server.query_service import VectorDBQueryService
from langchain.globals import set_verbose as set_langchain_verbose
from server.ingestion import DocumentProcessor
from common.utils import get_default_fresh_until, sanitize_url

metadata_storage: Optional[MetadataStorage] = None
vector_db: Optional[Milvus] = None
jobmanager: Optional[JobManager] = None
data_graph_db: Optional[GraphDB] = None
ontology_graph_db: Optional[GraphDB] = None

# Initialize logger
logger = utils.get_logger(__name__)
logger.setLevel( os.getenv("LOG_LEVEL", "INFO").upper())
print(f"LOG LEVEL set to {logger.level}")
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
sleep_on_init_failure = int(os.getenv("SLEEP_ON_INIT_FAILURE_SECONDS", 180)) # seconds to sleep on init failure before shutdown
max_documents_per_ingest = int(os.getenv("MAX_DOCUMENTS_PER_INGEST", 1000)) # max number of documents to ingest per ingestion request
max_results_per_query = int(os.getenv("MAX_RESULTS_PER_QUERY", 100)) # max number of results to return per query

default_collection_name_docs = "rag_default"
dense_index_params = {"index_type": "HNSW", "metric_type": "COSINE"}
sparse_index_params = {"index_type": "SPARSE_INVERTED_INDEX", "metric_type": "BM25"}

milvus_connection_args = {"uri": milvus_uri}

if graph_rag_enabled:
    logger.warning("Graph RAG is ENABLED ✅")
else:
    logger.warning("Graph RAG is DISABLED ❌")


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
    global ingestor

    redis_client = redis.from_url(redis_url, decode_responses=True)
    metadata_storage = MetadataStorage(redis_client=redis_client)
    jobmanager = JobManager(redis_client=redis_client)
    embeddings = AzureOpenAIEmbeddings(model=embeddings_model)

    logger.info("SKIP_INIT_TESTS=" + str(skip_init_tests))
    if not skip_init_tests:
        try:
            # Do some inital tests to ensure the connections are all working
            await init_tests(
                logger=logger,
                redis_client=redis_client,
                embeddings=embeddings,
                milvus_uri=milvus_uri
            )
        except Exception as e:
            logger.error(traceback.format_exc())
            logger.error("Initial connection tests failed, shutting down the app.")
            logger.error(f"Error in init test, sleeping {sleep_on_init_failure} seconds before shutdown...")
            time.sleep(sleep_on_init_failure)
            raise e

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

        # setup ingestor with graph db
        ingestor = DocumentProcessor(
            vstore=vector_db,
            graph_rag_enabled=graph_rag_enabled,
            job_manager=jobmanager,
            data_graph_db=data_graph_db
        )
    else:
        # setup ingestor without graph db
        ingestor = DocumentProcessor(
            vstore=vector_db,
            job_manager=jobmanager,
            graph_rag_enabled=graph_rag_enabled,
        )

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

def generate_ingestor_id(ingestor_name: str, ingestor_type: str) -> str:
    """Generate a unique ingestor ID for webloader ingestor"""
    return f"{ingestor_type}:{ingestor_name}"


# ============================================================================
# Ingestor Endpoints
# ============================================================================

@app.get("/v1/ingestors")
async def list_ingestors():
    """
    Lists all ingestors in the database
    """
    if not metadata_storage:
        raise HTTPException(status_code=500, detail="Server not initialized")
    logger.debug("Listing ingestors")
    ingestors = await metadata_storage.fetch_all_ingestor_info()
    return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(ingestors))

@app.post("/v1/ingestor/heartbeat", response_model=IngestorPingResponse, status_code=status.HTTP_200_OK)
async def ping_ingestor(ingestor_ping: IngestorPingRequest):
    """
    Registers a heartbeat from a ingestor, creating or updating its entry
    """
    if not metadata_storage:
        raise HTTPException(status_code=500, detail="Server not initialized")
    logger.info(f"Received heartbeat from ingestor: name={ingestor_ping.ingestor_name} type={ingestor_ping.ingestor_type}")
    ingestor_id = generate_ingestor_id(ingestor_ping.ingestor_name, ingestor_ping.ingestor_type)
    ingestor_info = IngestorInfo(
        ingestor_id=ingestor_id,
        ingestor_type=ingestor_ping.ingestor_type,
        ingestor_name=ingestor_ping.ingestor_name,
        description=ingestor_ping.description,
        metadata=ingestor_ping.metadata,
        last_seen=int(time.time())
    )
    await metadata_storage.store_ingestor_info(ingestor_info=ingestor_info)
    return IngestorPingResponse(
                ingestor_id=ingestor_id,
                message="Ingestor heartbeat registered",
                max_documents_per_ingest=max_documents_per_ingest
    )

@app.delete("/v1/ingestor/delete")
async def delete_ingestor(ingestor_id: str):
    """
    Deletes an ingestor from metadata storage, does not delete any associated datasources or data
    """
    if not vector_db or not metadata_storage:
        raise HTTPException(status_code=500, detail="Server not initialized")
    if graph_rag_enabled and not data_graph_db:
        raise HTTPException(status_code=500, detail="Server not initialized")

    # Fetch ingestor info - check if it exists
    ingestor_info =  await metadata_storage.get_ingestor_info(ingestor_id)

    if not ingestor_info:
        raise HTTPException(status_code=404, detail="Ingestor not found")

    logger.info(f"Deleting ingestor: {ingestor_id}")
    await metadata_storage.delete_ingestor_info(ingestor_id) # remove metadata

# ============================================================================
# Datasources Endpoints
# ============================================================================

@app.post("/v1/datasource", status_code=status.HTTP_202_ACCEPTED)
async def upsert_datasource(datasource_info: DataSourceInfo):
    """Create or update datasource metadata entry."""
    if not metadata_storage:
        raise HTTPException(status_code=500, detail="Server not initialized")

    await metadata_storage.store_datasource_info(datasource_info)

    return status.HTTP_202_ACCEPTED

@app.delete("/v1/datasource", status_code=status.HTTP_200_OK)
async def delete_datasource(datasource_id: str):
    """Delete datasource from vector storage and metadata."""

    # Check initialization
    if not vector_db or not metadata_storage or not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    if graph_rag_enabled and not data_graph_db:
        raise HTTPException(status_code=500, detail="Server not initialized")
    
    # Fetch datasource info
    datasource_info = await metadata_storage.get_datasource_info(datasource_id)
    if not datasource_info:
        raise HTTPException(status_code=404, detail="Datasource not found")

    # Check if any jobs are running for this datasource
    jobs = await jobmanager.get_jobs_by_datasource(datasource_id)
    if jobs and any(job.status == JobStatus.IN_PROGRESS for job in jobs):
        raise HTTPException(
            status_code=400,
            detail="Cannot delete datasource while ingestion job is in progress."
        )
    
    # remove all jobs for this datasource
    jobs = await jobmanager.get_jobs_by_datasource(datasource_id)
    if jobs:
        for job in jobs:
            await jobmanager.delete_job(job.job_id)

    await vector_db.adelete(expr=f"datasource_id == '{datasource_id}'")
    await metadata_storage.delete_datasource_info(datasource_id) # remove metadata

    if graph_rag_enabled and data_graph_db:
        await data_graph_db.remove_entity(None, {DATASOURCE_ID_KEY: datasource_id}) # remove from graph db


    return status.HTTP_200_OK

@app.get("/v1/datasources")
async def list_datasources(ingestor_id: Optional[str] = None):
    """List all stored datasources"""
    if not metadata_storage:
        raise HTTPException(status_code=500, detail="Server not initialized")
    try:
        datasources = await metadata_storage.fetch_all_datasource_info()
        if ingestor_id:
            datasources = [ds for ds in datasources if ds.ingestor_id == ingestor_id]
        return {
            "success": True,
            "datasources": datasources,
            "count": len(datasources)
        }
    except Exception as e:
        logger.error(f"Failed to list datasources: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# Job Endpoints
# ============================================================================
@app.get("/v1/job/{job_id}")
async def get_job(job_id: str):
    """Get the status of an ingestion job."""
    if not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    job_info = await jobmanager.get_job(job_id)
    if not job_info:
        raise HTTPException(status_code=404, detail="Job not found")

    logger.info(f"Returning job {job_info}")
    return job_info

@app.get("/v1/jobs/datasource/{datasource_id}")
async def get_jobs_by_datasource(datasource_id: str, status_filter: Optional[JobStatus] = None):
    """Get all jobs for a specific datasource, optionally filtered by status."""
    if not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    jobs = await jobmanager.get_jobs_by_datasource(datasource_id, status_filter=status_filter)
    if jobs is None:
        raise HTTPException(status_code=404, detail="No jobs found for the specified datasource")

    logger.info(f"Returning {len(jobs)} jobs for datasource {datasource_id}")
    return jobs

@app.post("/v1/job", status_code=status.HTTP_201_CREATED)
async def create_job(
    datasource_id: str,
    job_status: Optional[JobStatus] = None,
    message: Optional[str] = None,
    total: Optional[int] = None):
    """Create a new job for a datasource."""
    if not jobmanager or not metadata_storage:
        raise HTTPException(status_code=500, detail="Server not initialized")
    
    # Check if datasource exists
    datasource_info = await metadata_storage.get_datasource_info(datasource_id)
    if not datasource_info:
        raise HTTPException(status_code=404, detail="Datasource not found")
    
    # Generate new job ID
    job_id = str(uuid.uuid4())
    
    # Create job with datasource_id
    success = await jobmanager.upsert_job(
        job_id,
        status=job_status or JobStatus.PENDING,
        message=message or "Job created",
        total=total,
        datasource_id=datasource_id
    )
    
    if not success:
        raise HTTPException(status_code=400, detail="Failed to create job")
    
    logger.info(f"Created job {job_id} for datasource {datasource_id}")
    return {"job_id": job_id, "datasource_id": datasource_id}

@app.patch("/v1/job/{job_id}", status_code=status.HTTP_200_OK)
async def update_job(
    job_id: str,
    job_status: Optional[JobStatus] = None,
    message: Optional[str] = None,
    total: Optional[int] = None):
    """Update an existing job."""
    if not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    
    # Check if job exists
    existing_job = await jobmanager.get_job(job_id)
    if not existing_job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Update job
    success = await jobmanager.upsert_job(
        job_id,
        status=job_status,
        message=message,
        total=total,
        datasource_id=existing_job.datasource_id
    )
    
    if not success:
        raise HTTPException(status_code=400, detail="Failed to update job (job may be terminated)")
    
    logger.info(f"Updated job {job_id}")
    return {"job_id": job_id, "datasource_id": existing_job.datasource_id}

@app.post("/v1/job/{job_id}/terminate", status_code=status.HTTP_200_OK)
async def terminate_job_endpoint(job_id: str):
    """Terminate an ingestion job."""
    if not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    
    job_info = await jobmanager.get_job(job_id)
    if not job_info:
        raise HTTPException(status_code=404, detail="Job not found")

    success = await jobmanager.terminate_job(job_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to terminate job")
    
    logger.info(f"Job {job_id} has been terminated.")
    return {"message": f"Job {job_id} has been terminated."}

@app.post("/v1/job/{job_id}/increment-progress")
async def increment_job_progress(job_id: str, increment: int = 1):
    """Increment the progress counter for a job."""
    if not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    
    new_value = await jobmanager.increment_progress(job_id, increment)
    if new_value == -1:
        raise HTTPException(status_code=400, detail="Cannot increment progress - job is terminated")
    
    logger.debug(f"Incremented progress for job {job_id} by {increment}, new value: {new_value}")
    return {"job_id": job_id, "progress_counter": new_value}

@app.post("/v1/job/{job_id}/increment-failure")
async def increment_job_failure(job_id: str, increment: int = 1):
    """Increment the failure counter for a job."""
    if not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    
    new_value = await jobmanager.increment_failure(job_id, increment)
    if new_value == -1:
        raise HTTPException(status_code=400, detail="Cannot increment failure - job is terminated")
    
    logger.debug(f"Incremented failure for job {job_id} by {increment}, new value: {new_value}")
    return {"job_id": job_id, "failed_counter": new_value}

@app.post("/v1/job/{job_id}/add-errors")
async def add_job_errors(job_id: str, error_messages: List[str]):
    """Add error messages to a job."""
    if not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    
    if not error_messages:
        raise HTTPException(status_code=400, detail="Error messages list cannot be empty")
    
    results = []
    for error_msg in error_messages:
        new_length = await jobmanager.add_error_msg(job_id, error_msg)
        if new_length == -1:
            raise HTTPException(status_code=400, detail="Cannot add error messages - job is terminated")
        results.append(new_length)
    
    final_length = results[-1] if results else 0
    logger.debug(f"Added {len(error_messages)} error messages to job {job_id}, total errors: {final_length}")
    return {"job_id": job_id, "errors_added": len(error_messages), "total_errors": final_length}

# ============================================================================
# Query Endpoint
# ============================================================================

@app.post("/v1/query", response_model=List[QueryResult])
async def query_documents(query_request: QueryRequest):
    """Query for relevant documents using semantic search in the unified collection."""

    # Enforce max results limit
    if query_request.limit > max_results_per_query:
        raise HTTPException(status_code=400, detail=f"Query limit exceeds maximum allowed of {max_results_per_query} results.")

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
# Ingestion Endpoints
# ============================================================================

@app.post("/v1/ingest/webloader/url", status_code=status.HTTP_202_ACCEPTED)
async def ingest_url(url_request: UrlIngestRequest):
    """Queue a URL for ingestion by the webloader ingestor."""
    if not metadata_storage or not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    
    logger.info(f"Received URL ingestion request: {url_request.url}")
    
    # Sanitize URL and generate datasource ID from URL
    sanitized_url = sanitize_url(url_request.url)
    url_request.url = sanitized_url
    datasource_id = utils.generate_datasource_id_from_url(url_request.url)
    ingestor_id = generate_ingestor_id(WEBLOADER_INGESTOR_NAME, WEBLOADER_INGESTOR_TYPE)

    # Check if datasource already exists
    existing_datasource = await metadata_storage.get_datasource_info(datasource_id)
    if existing_datasource:
        logger.info(f"Datasource already exists for URL {url_request.url}, datasource ID: {datasource_id}")
        raise HTTPException(status_code=400, detail="URL already ingested, please delete existing datasource before re-ingesting")
    
    # Check if there is already a job for this datasource in progress or pending
    existing_jobs = await jobmanager.get_jobs_by_datasource(datasource_id)
    if existing_jobs:
        existing_pending_jobs = [job for job in existing_jobs if job.status in (JobStatus.IN_PROGRESS, JobStatus.PENDING)]
        if existing_pending_jobs:
            logger.info(f"An ingestion job is already in progress or pending for datasource {datasource_id}, job ID: {existing_pending_jobs[0].job_id}")
            raise HTTPException(status_code=400, detail=f"An ingestion job is already in progress or pending for this URL (job ID: {existing_pending_jobs[0].job_id})")
                
    # Create job with PENDING status first
    job_id = str(uuid.uuid4())
    success = await jobmanager.upsert_job(
        job_id,
        status=JobStatus.PENDING,
        message="Waiting for ingestor to process...",
        total=0,  # Unknown until sitemap is checked
        datasource_id=datasource_id
    )
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to create job")
    
    logger.info(f"Created job {job_id} for datasource {datasource_id}")
    
    if not url_request.description:
        url_request.description = f"Web content from {url_request.url}"

    # Create datasource
    datasource_info = DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=ingestor_id,
        description=url_request.description,
        source_type="web",
        last_updated=int(time.time()),
        default_chunk_size=1000,
        default_chunk_overlap=200,
        metadata={"url_ingest_request": url_request.model_dump()}
    )

    await metadata_storage.store_datasource_info(datasource_info)
    logger.info(f"Created datasource: {datasource_id}")
    
    # Queue the request for the ingestor
    ingestor_request = IngestorRequest(
        ingestor_id=ingestor_id,
        command=WebIngestorCommand.INGEST_URL,
        payload=url_request.model_dump()
    )
    
    # Push to Redis queue  
    await redis_client.rpush(WEBLOADER_INGESTOR_REDIS_QUEUE, ingestor_request.model_dump_json())  # type: ignore
    logger.info(f"Queued URL ingestion request for {url_request.url}")
    return {"datasource_id": datasource_id, "job_id": job_id, "message": "URL ingestion request queued"}


@app.post("/v1/ingest/webloader/reload", status_code=status.HTTP_202_ACCEPTED)
async def reload_url(reload_request: UrlReloadRequest):
    """Reloads a previously ingested URL by re-queuing it for ingestion."""
    if not metadata_storage or not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    
    # Fetch existing datasource
    datasource_info = await metadata_storage.get_datasource_info(reload_request.datasource_id)
    if not datasource_info:
        raise HTTPException(status_code=404, detail="Datasource not found")
        
    # Queue the request for the ingestor
    ingestor_request = IngestorRequest(
        ingestor_id=datasource_info.ingestor_id,
        command=WebIngestorCommand.RELOAD_DATASOURCE,
        payload=reload_request.model_dump()
    )
    
    # Push to Redis queue  
    await redis_client.rpush(WEBLOADER_INGESTOR_REDIS_QUEUE, ingestor_request.model_dump_json())  # type: ignore
    logger.info(f"Re-queued URL ingestion request for {reload_request.datasource_id}")
    return {"datasource_id": reload_request.datasource_id, "message": "URL reload ingestion request queued"}

@app.post("/v1/ingest/webloader/reload-all", status_code=status.HTTP_202_ACCEPTED)
async def reload_all_urls():
    """Reloads all previously ingested URLs by re-queuing them for ingestion."""
    if not metadata_storage or not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    
     # Queue the request for the ingestor
    ingestor_request = IngestorRequest(
        ingestor_id=generate_ingestor_id(WEBLOADER_INGESTOR_NAME, WEBLOADER_INGESTOR_TYPE),
        command=WebIngestorCommand.RELOAD_ALL,
        payload={}
    )

    # Push to Redis queue
    await redis_client.rpush(WEBLOADER_INGESTOR_REDIS_QUEUE, ingestor_request.model_dump_json())  # type: ignore
    logger.info(f"Re-queued URL ingestion request for all datasources")
    
    return {"message": "Reload all URLs request queued"}

@app.post("/v1/ingest")
async def ingest_documents(ingest_request: DocumentIngestRequest):
    """Updates/Ingests text and graph data to the appropriate databases"""

    if not vector_db or not metadata_storage or not ingestor or not jobmanager:
        raise HTTPException(status_code=500, detail="Server not initialized")
    logger.info(f"Starting data ingestion for datasource: {ingest_request.datasource_id}")

    # Check if datasource exists
    datasource_info = await metadata_storage.get_datasource_info(ingest_request.datasource_id)
    if not datasource_info:
        raise HTTPException(status_code=404, detail="Datasource not found")
    
    # Find the current job for this datasource is IN_PROGRESS
    job_info = await jobmanager.get_job(ingest_request.job_id)
    if not job_info:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job_info.status != JobStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="Ingestion can only be started for jobs in IN_PROGRESS status")

    # Check max documents limit
    if len(ingest_request.documents) > max_documents_per_ingest:
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"message": f"Number of documents exceeds the maximum limit of {max_documents_per_ingest} per ingestion request."})
    
    if ingest_request.fresh_until is None:
        ingest_request.fresh_until = get_default_fresh_until()

    try:
        await ingestor.ingest_documents(
            ingestor_id=ingest_request.ingestor_id,
            datasource_id=ingest_request.datasource_id,
            job_id=job_info.job_id,
            documents=ingest_request.documents,
            fresh_until=ingest_request.fresh_until,
            chunk_overlap=datasource_info.default_chunk_overlap,
            chunk_size=datasource_info.default_chunk_size,
        )
    except ValueError as ve:
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"message": str(ve)})
    return JSONResponse(status_code=status.HTTP_202_ACCEPTED, content={"message": "Text data ingestion started successfully"})

# ============================================================================
# Knowledge Graph Endpoints
# ============================================================================

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

    # Fetch the current ontology version id
    ontology_version_id = await redis_client.get(KV_ONTOLOGY_VERSION_ID_KEY)
    if ontology_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Ontology version not found")

    # Add ontology version to filter properties
    filter_by_props = explore_entity_request.filter_by_properties or {}
    filter_by_props[ONTOLOGY_VERSION_ID_KEY] = ontology_version_id

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

    # Fetch the current ontology version id
    ontology_version_id = await redis_client.get(KV_ONTOLOGY_VERSION_ID_KEY)
    if ontology_version_id is None:
        raise HTTPException(status_code=500, detail="Intial setup not completed. Ontology version not found")

    # Add ontology version to filter properties
    filter_by_props = explore_relations_request.filter_by_properties or {}
    filter_by_props[ONTOLOGY_VERSION_ID_KEY] = ontology_version_id

    logger.debug(f"Finding relation: {explore_relations_request.from_type}, {explore_relations_request.to_type}, {explore_relations_request.relation_name}, {filter_by_props}")
    relations = await ontology_graph_db.find_relations(explore_relations_request.from_type, explore_relations_request.to_type, explore_relations_request.relation_name, filter_by_props, max_results=1000)
    if len(relations) < 0:
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"message": "No relations found"})
    return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(relations))

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
# Health Check and Configuration Endpoint
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
            },
            "ui_url": ui_url,
            "datasources": await metadata_storage.fetch_all_datasource_info() if metadata_storage else []
    }

    if graph_rag_enabled:
        if data_graph_db and ontology_graph_db:
            config["graph_db"] = {
                "data_graph": {
                    "type": data_graph_db.database_type,
                    "query_language": data_graph_db.query_language,
                    "uri": neo4j_addr
                },
                "ontology_graph": {
                    "type": ontology_graph_db.database_type,
                    "query_language": ontology_graph_db.query_language,
                    "uri": ontology_neo4j_addr
                },
                "graph_entity_types": await data_graph_db.get_all_entity_types() if data_graph_db else []
            }

    response = {
        "status": health_status,
        "timestamp": int(time.time()),
        "details": health_details,
        "config": config
    }
    return response

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