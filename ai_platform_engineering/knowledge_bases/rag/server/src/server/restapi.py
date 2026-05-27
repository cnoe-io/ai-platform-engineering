from contextlib import asynccontextmanager
import asyncio
import re
import traceback
import uuid
from urllib.parse import urlparse
from common import utils
from fastapi import FastAPI, status, HTTPException, Query, Depends
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastmcp import FastMCP
from server.tools import AgentTools
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import PlainTextResponse, StreamingResponse
from starlette.background import BackgroundTask
from typing import List, Optional
import logging
from langchain_core.documents import Document
from common.metadata_storage import MetadataStorage
from common.job_manager import JobManager, JobStatus
from common.models.server import (
  ExploreNeighborhoodRequest,
  DocumentIngestRequest,
  IngestorPingRequest,
  IngestorPingResponse,
  UrlIngestRequest,
  IngestorRequest,
  WebIngestorCommand,
  ConfluenceIngestorCommand,
  UrlReloadRequest,
  ConfluenceIngestRequest,
  ConfluenceReloadRequest,
  JobsBatchRequest,
  MCPToolInvokeRequest,
  MCPToolInvokeResponse,
  DatasourceDocumentsResponse,
  DocumentInfo,
  ChunkInfo,
  ChunkContentResponse,
  CleanupResponse,
)
from common.models.rag import DataSourceInfo, IngestorInfo, valid_metadata_keys, valid_metadata_keys_with_types, MCPToolConfig, MCPBuiltinToolsConfig
from common.models.rbac import Role, UserContext, UserInfoResponse
from server.rbac import get_user_or_anonymous, require_role, has_permission, get_permissions, is_trusted_request, UserInfoCache, set_userinfo_cache, get_auth_manager, _authenticate_from_token
from common.graph_db.neo4j.graph_db import Neo4jDB
from common.graph_db.base import GraphDB
from common.constants import DATASOURCE_ID_KEY, WEBLOADER_INGESTOR_REDIS_QUEUE, WEBLOADER_INGESTOR_NAME, WEBLOADER_INGESTOR_TYPE, CONFLUENCE_INGESTOR_REDIS_QUEUE, CONFLUENCE_INGESTOR_NAME, CONFLUENCE_INGESTOR_TYPE, DEFAULT_DATA_LABEL, DEFAULT_SCHEMA_LABEL
from common.embeddings_factory import EmbeddingsFactory
import redis.asyncio as redis
from langchain_milvus import BM25BuiltInFunction, Milvus
from pymilvus import MilvusClient
import time
import os
import httpx
from server.query_service import VectorDBQueryService
from langchain_core.globals import set_verbose as set_langchain_verbose
from server.ingestion import DocumentProcessor
from common.utils import get_fresh_until, sanitize_url

metadata_storage: Optional[MetadataStorage] = None
vector_db: Optional[Milvus] = None
jobmanager: Optional[JobManager] = None
data_graph_db: Optional[GraphDB] = None
ontology_graph_db: Optional[GraphDB] = None
agent_tools: Optional[AgentTools] = None

# Initialize logger
logger = utils.get_logger(__name__)
logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
print(f"LOG LEVEL set to {logger.level}")
if logger.level == logging.DEBUG:  # enable langchain verbose logging
  set_langchain_verbose(True)

# Read configuration from environment variables
clean_up_interval = int(os.getenv("CLEANUP_INTERVAL", 3 * 60 * 60))  # Default to 3 hours
cleanup_enabled = os.getenv("CLEANUP_ENABLED", "true").lower() in ("true", "1", "yes")
ontology_agent_client = httpx.AsyncClient(base_url=os.getenv("ONTOLOGY_AGENT_RESTAPI_ADDR", "http://localhost:8098"))
graph_rag_enabled = os.getenv("ENABLE_GRAPH_RAG", "true").lower() in ("true", "1", "yes")
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
milvus_uri = os.getenv("MILVUS_URI", "http://localhost:19530")
embeddings_model = os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-small")
neo4j_addr = os.getenv("NEO4J_ADDR", "bolt://localhost:7687")
skip_init_tests = os.getenv("SKIP_INIT_TESTS", "false").lower() in ("true", "1", "yes")  # used when debugging to skip connection tests
max_ingestion_concurrency = int(os.getenv("MAX_INGESTION_CONCURRENCY", 30))  # max concurrent tasks during ingestion for one datasource
ui_url = os.getenv("UI_URL", "http://localhost:9447")
mcp_enabled = os.getenv("ENABLE_MCP", "true").lower() in ("true", "1", "yes")
mcp_auth_enabled = os.getenv("MCP_AUTH_ENABLED", "true").lower() in ("true", "1", "yes")
sleep_on_init_failure = int(os.getenv("SLEEP_ON_INIT_FAILURE_SECONDS", 180))  # seconds to sleep on init failure before shutdown
max_documents_per_ingest = int(os.getenv("MAX_DOCUMENTS_PER_INGEST", 1000))  # max number of documents to ingest per ingestion request
confluence_url = os.getenv("CONFLUENCE_URL")  # optional - base URL for Confluence instance (e.g., https://company.atlassian.net/wiki)

default_collection_name_docs = "rag_default"
dense_index_params = {"index_type": "HNSW", "metric_type": "COSINE"}
sparse_index_params = {"index_type": "SPARSE_INVERTED_INDEX", "metric_type": "BM25"}

milvus_connection_args = {"uri": milvus_uri}

if graph_rag_enabled:
  logger.warning("Graph RAG is ENABLED ✅")
else:
  logger.warning("Graph RAG is DISABLED ❌")

if cleanup_enabled:
  logger.info(f"Periodic cleanup is ENABLED (interval: {clean_up_interval}s / {clean_up_interval / 3600:.1f}h)")
else:
  logger.info("Periodic cleanup is DISABLED")

# Background task handle for periodic cleanup
cleanup_task: asyncio.Task | None = None
# Track last cleanup timestamp (Unix seconds)
last_cleanup_timestamp: int | None = None


async def run_safe_bulk_cleanup() -> tuple[int, int, int]:
  """
  Run a safe bulk cleanup that:
  1. Iterates over each datasource
  2. Skips cleanup if latest job has failed
  3. Cleans up stale data for datasources with successful jobs
  4. Cleans up orphaned documents where datasource_id doesn't exist

  Returns tuple of (datasources_cleaned, datasources_skipped, orphaned_cleaned).
  """
  if not vector_db or not metadata_storage or not jobmanager:
    raise RuntimeError("Server not initialized")

  now = int(time.time())
  datasources_cleaned = 0
  datasources_skipped = 0

  # Get all datasources
  datasources = await metadata_storage.fetch_all_datasource_info()
  datasource_ids = {ds.datasource_id for ds in datasources}

  logger.info(f"Safe bulk cleanup: checking {len(datasources)} datasources")

  # Process each datasource
  for ds in datasources:
    try:
      # Get the latest job for this datasource
      jobs = await jobmanager.get_jobs_by_datasource(ds.datasource_id)
      latest_job = jobs[0] if jobs else None

      # Skip cleanup if latest job has failed
      if latest_job and latest_job.status == JobStatus.FAILED:
        logger.warning(f"Skipping cleanup for datasource {ds.datasource_id} - latest job {latest_job.job_id} has status FAILED")
        datasources_skipped += 1
        continue

      logger.debug(f"Cleaning up stale data for datasource {ds.datasource_id}")

      # Clean up stale Milvus chunks for this datasource
      expr = f"datasource_id == '{ds.datasource_id}' and fresh_until < {now}"
      try:
        await vector_db.adelete(expr=expr)
      except Exception as e:
        logger.error(f"Failed to delete stale chunks for datasource {ds.datasource_id}: {e}")
        continue

      # Clean up stale Neo4j entities for this datasource
      if graph_rag_enabled and data_graph_db:
        try:
          await data_graph_db.remove_stale_entities(datasource_id=ds.datasource_id)
        except Exception as e:
          logger.warning(f"Failed to delete stale structured entities for datasource {ds.datasource_id}: {e}")
          # Don't fail the whole operation if graph cleanup fails

      datasources_cleaned += 1
      logger.debug(f"Cleanup completed for datasource {ds.datasource_id}")

    except Exception as e:
      logger.error(f"Error cleaning up datasource {ds.datasource_id}: {e}")
      datasources_skipped += 1

  # Clean up orphaned documents (where datasource_id doesn't exist in metadata storage)
  orphaned_cleaned = 0
  try:
    # Query Milvus to get distinct datasource_ids that have stale chunks
    # We can't easily get distinct values, so we delete orphans by checking
    # chunks where datasource_id is not in our known set
    # Build a NOT IN expression for orphan cleanup
    if datasource_ids:
      # Milvus doesn't support NOT IN directly, so we need to find orphans differently
      # Query all stale chunks and filter client-side, then delete
      results = vector_db.client.query(
        collection_name=default_collection_name_docs,
        filter=f"fresh_until < {now}",
        output_fields=["id", "datasource_id"],
        limit=16383,  # Milvus max
      )

      # Find orphaned chunk IDs (where datasource_id is not in known datasources)
      orphan_ids = [r["id"] for r in results if r.get("datasource_id") not in datasource_ids]

      if orphan_ids:
        logger.info(f"Found {len(orphan_ids)} orphaned stale chunks to delete")
        # Delete in batches to avoid hitting limits
        batch_size = 1000
        for i in range(0, len(orphan_ids), batch_size):
          batch = orphan_ids[i : i + batch_size]
          await vector_db.adelete(ids=batch)
        orphaned_cleaned = len(orphan_ids)

  except Exception as e:
    logger.error(f"Failed to cleanup orphaned documents: {e}")

  logger.info(f"Safe bulk cleanup completed: {datasources_cleaned} datasources cleaned, {datasources_skipped} skipped, {orphaned_cleaned} orphaned chunks removed")
  return datasources_cleaned, datasources_skipped, orphaned_cleaned


async def periodic_cleanup_task():
  """
  Background task that periodically removes stale chunks from Milvus and Neo4j.
  Uses safe bulk cleanup that skips datasources with failed latest jobs.
  """
  global last_cleanup_timestamp
  logger.info(f"Starting periodic cleanup task (interval: {clean_up_interval}s)")
  while True:
    try:
      await asyncio.sleep(clean_up_interval)
      logger.info("Running periodic cleanup...")

      await run_safe_bulk_cleanup()

      # Update last cleanup timestamp
      last_cleanup_timestamp = int(time.time())
      logger.info("Periodic cleanup completed")

    except asyncio.CancelledError:
      logger.info("Periodic cleanup task cancelled")
      break
    except Exception as e:
      logger.error(f"Periodic cleanup task error: {e}")
      # Continue running despite errors


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

  # Initialize userinfo cache for RBAC (caches email/groups fetched from OIDC userinfo)
  userinfo_cache = UserInfoCache(redis_client=redis_client)
  set_userinfo_cache(userinfo_cache)

  # Use EmbeddingsFactory to get embeddings based on EMBEDDINGS_PROVIDER env var
  embeddings = EmbeddingsFactory.get_embeddings()

  logger.info("SKIP_INIT_TESTS=" + str(skip_init_tests))
  if not skip_init_tests:
    try:
      # Do some inital tests to ensure the connections are all working
      await init_tests(logger=logger, redis_client=redis_client, embeddings=EmbeddingsFactory(), milvus_uri=milvus_uri)
    except Exception as e:
      logger.error(traceback.format_exc())
      logger.error("Initial connection tests failed, shutting down the app.")
      logger.error(f"Error in init test, sleeping {sleep_on_init_failure} seconds before shutdown...")
      logger.error("Press Ctrl+C to exit immediately...")
      try:
        for remaining in range(sleep_on_init_failure, 0, -1):
          logger.info(f"Shutting down in {remaining} seconds...")
          time.sleep(1)
      except KeyboardInterrupt:
        logger.info("Shutdown interrupted by user (Ctrl+C)")
      raise e

  # Setup vector db for document data
  vector_db = Milvus(
    embedding_function=embeddings,
    collection_name=default_collection_name_docs,
    connection_args=milvus_connection_args,
    index_params=[dense_index_params, sparse_index_params],
    builtin_function=BM25BuiltInFunction(output_field_names="sparse"),
    vector_field=["dense", "sparse"],
    enable_dynamic_field=True,  # allow for dynamic metadata fields
  )

  # Ensure the collection exists (required for upsert operations)
  # The Milvus langchain wrapper only auto-creates collections on add_documents, not upsert
  if not vector_db.client.has_collection(default_collection_name_docs):
    logger.info(f"Collection {default_collection_name_docs} does not exist, creating it...")
    # Add a dummy document to trigger collection creation with proper schema
    dummy_doc = Document(page_content="__init__", metadata={"_init": True})
    vector_db.add_documents(documents=[dummy_doc], ids=["__init_doc__"])
    # Delete the dummy document
    vector_db.delete(ids=["__init_doc__"])
    logger.info(f"Collection {default_collection_name_docs} created successfully")
  else:
    logger.info(f"Collection {default_collection_name_docs} already exists")

  vector_db_query_service = VectorDBQueryService(vector_db=vector_db)

  if graph_rag_enabled:
    # Setup graph dbs - both use the same Neo4j instance with different tenant labels
    data_graph_db = Neo4jDB(tenant_label=DEFAULT_DATA_LABEL, uri=neo4j_addr)
    await data_graph_db.setup()
    ontology_graph_db = Neo4jDB(tenant_label=DEFAULT_SCHEMA_LABEL, uri=neo4j_addr)
    await ontology_graph_db.setup()

    # setup ingestor with graph db
    ingestor = DocumentProcessor(vstore=vector_db, graph_rag_enabled=graph_rag_enabled, job_manager=jobmanager, data_graph_db=data_graph_db, batch_size=max_documents_per_ingest)
  else:
    # setup ingestor without graph db
    ingestor = DocumentProcessor(vstore=vector_db, job_manager=jobmanager, graph_rag_enabled=graph_rag_enabled, batch_size=max_documents_per_ingest)

  # Start periodic cleanup background task
  global cleanup_task
  if cleanup_enabled:
    cleanup_task = asyncio.create_task(periodic_cleanup_task())
    logger.info("Periodic cleanup task started")

  yield

  # Shutdown
  logging.info("Shutting down the app...")

  # Cancel the cleanup task
  if cleanup_task:
    cleanup_task.cancel()
    try:
      await cleanup_task
    except asyncio.CancelledError:
      pass
    logger.info("Periodic cleanup task stopped")


if mcp_enabled:
  # Initialize MCP server
  mcp = FastMCP("RAG Tools")
  mcp_app = mcp.http_app(path="/mcp")


# Tool IDs that map to the built-in seeded search tool (can update, cannot create/delete)
# Tool IDs permanently blocked from custom tool creation (shadow built-in tools)
RESERVED_TOOL_IDS = {"search", "fetch_document", "list_datasources_and_entity_types"}


# Combine both lifespans - App and MCP (if enabled)
@asynccontextmanager
async def combined_lifespan(app: FastAPI):
  async with app_lifespan(app):
    if not mcp_enabled:
      yield  # Skip MCP setup
    else:
      if not metadata_storage:
        raise HTTPException(status_code=500, detail="Cannot initialize MCP server - metadata storage not initialized")

      global agent_tools

      # Seed default configs if not already present in Redis
      if not await metadata_storage.get_mcp_builtin_config():
        await metadata_storage.store_mcp_builtin_config(MCPBuiltinToolsConfig())
        logger.info("Seeded default MCPBuiltinToolsConfig")

      # Initialize MCP server tools
      agent_tools = AgentTools(
        vector_db_query_service=vector_db_query_service,
        redis_client=redis_client,
        metadata_storage=metadata_storage,
        data_graph_db=data_graph_db,
        ontology_graph_db=ontology_graph_db,
      )

      # Load configs from Redis and register tools
      builtin_config = await metadata_storage.get_mcp_builtin_config() or MCPBuiltinToolsConfig()
      tool_configs = await metadata_storage.fetch_all_mcp_tool_configs()
      await agent_tools.register_tools(mcp, graph_rag_enabled=graph_rag_enabled, builtin_config=builtin_config, tool_configs=tool_configs)

      # Register MCP app lifespan
      async with mcp_app.lifespan(app):
        yield


# Initialize FastAPI app
class MCPAuthMiddleware(BaseHTTPMiddleware):
  """
  Middleware that enforces authentication on /mcp* routes.

  FastMCP routes are registered outside FastAPI's dependency injection system
  so they cannot use Depends()-based auth guards. This middleware intercepts
  requests to /mcp* paths and applies the same auth logic as require_authenticated_user():
    1. Valid Bearer JWT -> allowed through
    2. Trusted network (CIDR / X-Trust-Token) -> allowed through
    3. Anything else -> 401

  Non-MCP routes are unaffected and continue to use their own Depends() guards.
  """

  async def dispatch(self, request: Request, call_next):
    if not request.url.path.startswith("/mcp"):
      return await call_next(request)

    # Allow OPTIONS (CORS preflight) without auth
    if request.method == "OPTIONS":
      return await call_next(request)

    auth_header = request.headers.get("Authorization")
    if auth_header:
      if not auth_header.startswith("Bearer "):
        return self._unauthorized("Invalid Authorization header format. Expected 'Bearer <token>'.", request)
      auth_manager = get_auth_manager()
      user = await _authenticate_from_token(request, auth_manager)
      if user:
        return await call_next(request)
      return self._unauthorized("Invalid or expired token.", request)

    if is_trusted_request(request):
      return await call_next(request)

    return self._unauthorized("Missing or malformed Authorization header.", request)

  def _unauthorized(self, reason: str, request: Request):
    accept = request.headers.get("accept", "")
    if "text/event-stream" in accept:
      return PlainTextResponse(f"error unauthorized: {reason}", status_code=401, media_type="text/event-stream")
    return JSONResponse({"error": "unauthorized", "reason": reason}, status_code=401)


if mcp_enabled:
  app = FastAPI(
    title="CAIPE RAG API",
    description="API for indexing and querying knowledge base for CAIPE",
    version="2.0.0",
    lifespan=combined_lifespan,
    routes=[*mcp_app.routes],  # Include MCP routes
  )
  if mcp_auth_enabled:
    app.add_middleware(MCPAuthMiddleware)
    logger.info("MCP authentication is ENABLED")
  else:
    logger.info("MCP authentication is DISABLED")
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
# User Info Endpoint
# ============================================================================


@app.get(
  "/v1/user/info",
  response_model=UserInfoResponse,
  tags=["Authentication"],
  summary="Get current user information",
  description="""
    Retrieve the current user's authentication status, role, and permissions.
    
    This endpoint is used by the UI to:
    - Display the logged-in user's email and role
    - Show/hide features based on role-based permissions
    - Enable/disable action buttons based on what the user can do
    
    **No authentication required** - this endpoint is accessible to all users.
    - Authenticated users will see their email, role, and groups
    - Unauthenticated users will see email as "anonymous" with no permissions
    - Trusted network users will see email as "trusted-network"
    
    **Permissions list:**
    - `read`: Can query and view data (READONLY, INGESTONLY, ADMIN)
    - `ingest`: Can ingest new data and manage ingestion jobs (INGESTONLY, ADMIN)
    - `delete`: Can delete resources and perform bulk operations (ADMIN only)
    """,
  responses={
    200: {
      "description": "Successfully retrieved user information",
      "content": {
        "application/json": {
          "examples": {
            "authenticated": {"summary": "Authenticated user", "value": {"email": "user@example.com", "role": "readonly", "is_authenticated": True, "groups": ["engineering", "platform-team"], "permissions": ["read"], "in_trusted_network": False}},
            "anonymous": {"summary": "Anonymous user", "value": {"email": "anonymous", "role": "anonymous", "is_authenticated": False, "groups": [], "permissions": [], "in_trusted_network": False}},
            "trusted_network": {"summary": "Trusted network user", "value": {"email": "trusted-network", "role": "admin", "is_authenticated": False, "groups": [], "permissions": ["read", "ingest", "delete"], "in_trusted_network": True}},
          }
        }
      },
    }
  },
)
async def get_user_info(request: Request, user: UserContext = Depends(get_user_or_anonymous)):
  """Get current user's authentication and role information."""
  # Determine if request is from trusted network
  trusted = is_trusted_request(request)

  return UserInfoResponse(email=user.email, role=user.role, is_authenticated=user.is_authenticated, groups=user.groups, permissions=get_permissions(user.role), in_trusted_network=trusted)


# ============================================================================
# Ingestor Endpoints
# ============================================================================


@app.get("/v1/ingestors")
async def list_ingestors(user: UserContext = Depends(require_role(Role.READONLY))):
  """
  Lists all ingestors in the database
  """
  if not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")
  logger.debug("Listing ingestors")
  ingestors = await metadata_storage.fetch_all_ingestor_info()
  return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(ingestors))


@app.post("/v1/ingestor/heartbeat", response_model=IngestorPingResponse, status_code=status.HTTP_200_OK)
async def ping_ingestor(ingestor_ping: IngestorPingRequest, user: UserContext = Depends(require_role(Role.INGESTONLY))):
  """
  Registers a heartbeat from a ingestor, creating or updating its entry
  """
  if not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")
  logger.info(f"Received heartbeat from ingestor: name={ingestor_ping.ingestor_name} type={ingestor_ping.ingestor_type} (by {user.email})")
  ingestor_id = generate_ingestor_id(ingestor_ping.ingestor_name, ingestor_ping.ingestor_type)
  ingestor_info = IngestorInfo(ingestor_id=ingestor_id, ingestor_type=ingestor_ping.ingestor_type, ingestor_name=ingestor_ping.ingestor_name, description=ingestor_ping.description, metadata=ingestor_ping.metadata, last_seen=int(time.time()))
  await metadata_storage.store_ingestor_info(ingestor_info=ingestor_info)
  return IngestorPingResponse(ingestor_id=ingestor_id, message="Ingestor heartbeat registered", max_documents_per_ingest=max_documents_per_ingest)


@app.delete("/v1/ingestor/delete")
async def delete_ingestor(ingestor_id: str, user: UserContext = Depends(require_role(Role.ADMIN))):
  """
  Deletes an ingestor from metadata storage, does not delete any associated datasources or data
  """
  if not vector_db or not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")
  if graph_rag_enabled and not data_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized")

  # Fetch ingestor info - check if it exists
  ingestor_info = await metadata_storage.get_ingestor_info(ingestor_id)

  if not ingestor_info:
    raise HTTPException(status_code=404, detail="Ingestor not found")

  logger.warning(f"Deleting ingestor: {ingestor_id} (by {user.email})")
  await metadata_storage.delete_ingestor_info(ingestor_id)  # remove metadata


# ============================================================================
# Datasources Endpoints
# ============================================================================


@app.post("/v1/datasource", status_code=status.HTTP_202_ACCEPTED)
async def upsert_datasource(datasource_info: DataSourceInfo, user: UserContext = Depends(require_role(Role.INGESTONLY))):
  """Create or update datasource metadata entry."""
  if not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")

  await metadata_storage.store_datasource_info(datasource_info)

  return status.HTTP_202_ACCEPTED


@app.delete("/v1/datasource", status_code=status.HTTP_200_OK)
async def delete_datasource(datasource_id: str, user: UserContext = Depends(require_role(Role.ADMIN))):
  """Delete datasource from vector storage and metadata."""

  # Check initialization
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
    raise HTTPException(status_code=400, detail="Cannot delete datasource while ingestion job is in progress.")

  # remove all jobs for this datasource
  jobs = await jobmanager.get_jobs_by_datasource(datasource_id)
  if jobs:
    for job in jobs:
      await jobmanager.delete_job(job.job_id)

  await vector_db.adelete(expr=f"datasource_id == '{datasource_id}'")
  await metadata_storage.delete_datasource_info(datasource_id)  # remove metadata

  if graph_rag_enabled and data_graph_db:
    await data_graph_db.remove_entity(None, {DATASOURCE_ID_KEY: datasource_id})  # remove from graph db

  return status.HTTP_200_OK


@app.post("/v1/datasource/{datasource_id}/cleanup", response_model=CleanupResponse)
async def cleanup_datasource_stale(
  datasource_id: str,
  user: UserContext = Depends(require_role(Role.ADMIN)),
):
  """
  Delete stale chunks from a specific datasource.

  Stale chunks are those where fresh_until < current time.
  This is useful for cleaning up orphaned data without removing
  the entire datasource.
  """
  if not vector_db or not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")

  # Verify datasource exists
  datasource_info = await metadata_storage.get_datasource_info(datasource_id)
  if not datasource_info:
    raise HTTPException(status_code=404, detail="Datasource not found")

  now = int(time.time())

  # Delete stale Milvus chunks for this datasource
  expr = f"datasource_id == '{datasource_id}' and fresh_until < {now}"
  try:
    await vector_db.adelete(expr=expr)
  except Exception as e:
    logger.error(f"Failed to delete stale chunks for datasource {datasource_id}: {e}")
    raise HTTPException(status_code=500, detail=f"Failed to delete stale chunks: {e}")

  # Delete stale Neo4j entities for this datasource
  if graph_rag_enabled and data_graph_db:
    try:
      await data_graph_db.remove_stale_entities(datasource_id=datasource_id)
    except Exception as e:
      logger.warning(f"Failed to delete stale structured entities for datasource {datasource_id}: {e}")
      # Don't fail the whole operation if graph cleanup fails

  logger.info(f"Cleanup completed for datasource {datasource_id}")

  return CleanupResponse(datasource_id=datasource_id, success=True, message="Cleanup completed successfully")


@app.post("/v1/datasources/cleanup", response_model=CleanupResponse)
async def cleanup_all_stale(
  user: UserContext = Depends(require_role(Role.ADMIN)),
):
  """
  Delete all stale chunks across all datasources safely.

  This operation:
  1. Iterates over each datasource
  2. Skips cleanup if the latest job has failed (to avoid deleting data that may need recovery)
  3. Cleans up stale data for datasources with successful/non-failed jobs
  4. Cleans up orphaned documents where datasource_id doesn't exist in metadata

  Stale chunks are those where fresh_until < current time.
  """
  if not vector_db or not metadata_storage or not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  try:
    datasources_cleaned, datasources_skipped, orphaned_cleaned = await run_safe_bulk_cleanup()

    # Update last cleanup timestamp
    global last_cleanup_timestamp
    last_cleanup_timestamp = int(time.time())

    message = f"Bulk cleanup completed: {datasources_cleaned} datasources cleaned"
    if datasources_skipped > 0:
      message += f", {datasources_skipped} skipped (failed jobs)"
    if orphaned_cleaned > 0:
      message += f", {orphaned_cleaned} orphaned chunks removed"

    return CleanupResponse(datasource_id=None, success=True, message=message)

  except RuntimeError as e:
    raise HTTPException(status_code=500, detail=str(e))
  except Exception as e:
    logger.error(f"Bulk cleanup failed: {e}")
    raise HTTPException(status_code=500, detail=f"Bulk cleanup failed: {e}")


@app.get("/v1/datasources")
async def list_datasources(ingestor_id: Optional[str] = None, user: UserContext = Depends(require_role(Role.READONLY))):
  """List all stored datasources"""
  if not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")
  try:
    datasources = await metadata_storage.fetch_all_datasource_info()
    if ingestor_id:
      datasources = [ds for ds in datasources if ds.ingestor_id == ingestor_id]
    return {"success": True, "datasources": datasources, "count": len(datasources)}
  except Exception as e:
    logger.error(f"Failed to list datasources: {e}")
    raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/datasource/{datasource_id}/documents", response_model=DatasourceDocumentsResponse)
async def list_datasource_documents(
  datasource_id: str,
  offset: int = Query(default=0, ge=0, description="Number of chunks to skip"),
  limit: int = Query(default=100, ge=1, le=1000, description="Number of chunks to fetch"),
  user: UserContext = Depends(require_role(Role.READONLY)),
):
  """List documents and chunks for a datasource with pagination (without content)."""
  if not vector_db:
    raise HTTPException(status_code=500, detail="Server not initialized")

  # Validate Milvus constraint: offset + limit must be < 16384
  if offset + limit >= 16384:
    raise HTTPException(
      status_code=400,
      detail="offset + limit must be less than 16,384 (Milvus query limitation)",
    )

  try:
    # Fetch limit + 1 to determine if more chunks exist
    results = vector_db.client.query(
      collection_name=default_collection_name_docs,
      filter=f"datasource_id == '{datasource_id}'",
      output_fields=["id", "document_id", "title", "chunk_index", "total_chunks", "fresh_until", "document_type", "document_ingested_at", "is_structured_entity", "source"],
      offset=offset,
      limit=limit + 1,
    )

    # Determine if more chunks exist beyond this batch
    has_more = len(results) > limit
    actual_results = results[:limit]  # Trim to requested limit

    # Group chunks by document_id
    documents_map: dict[str, DocumentInfo] = {}
    for chunk in actual_results:
      doc_id = chunk.get("document_id", "unknown")

      if doc_id not in documents_map:
        documents_map[doc_id] = DocumentInfo(
          document_id=doc_id,
          title=chunk.get("title", ""),
          chunks=[],
        )

      # Build chunk metadata (exclude fields that are already top-level or not needed)
      metadata = {
        "fresh_until": chunk.get("fresh_until"),
        "document_type": chunk.get("document_type"),
        "document_ingested_at": chunk.get("document_ingested_at"),
        "is_structured_entity": chunk.get("is_structured_entity", False),
        "source": chunk.get("source"),
      }

      documents_map[doc_id].chunks.append(
        ChunkInfo(
          id=chunk.get("id", ""),
          chunk_index=chunk.get("chunk_index", 0),
          total_chunks=chunk.get("total_chunks", 1),
          metadata=metadata,
        )
      )

    # Sort chunks within each document by chunk_index
    for doc in documents_map.values():
      doc.chunks.sort(key=lambda c: c.chunk_index)

    # Convert to list and sort by document_id
    documents = sorted(documents_map.values(), key=lambda d: d.document_id)
    total_chunks = sum(len(doc.chunks) for doc in documents)

    return DatasourceDocumentsResponse(
      datasource_id=datasource_id,
      documents=documents,
      total_documents=len(documents),
      total_chunks=total_chunks,
      offset=offset,
      limit=limit,
      has_more=has_more,
    )

  except HTTPException:
    raise
  except Exception as e:
    logger.error(f"Failed to list documents for datasource {datasource_id}: {e}")
    raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/chunk/{chunk_id:path}/content", response_model=ChunkContentResponse)
async def get_chunk_content(
  chunk_id: str,
  user: UserContext = Depends(require_role(Role.READONLY)),
):
  """Fetch the text content of a specific chunk."""
  if not vector_db:
    raise HTTPException(status_code=500, detail="Server not initialized")

  try:
    # Query Milvus for the specific chunk by ID
    results = vector_db.client.query(
      collection_name=default_collection_name_docs,
      filter=f"id == '{chunk_id}'",
      output_fields=["id", "text"],
      limit=1,
    )

    if not results:
      raise HTTPException(status_code=404, detail="Chunk not found")

    chunk = results[0]
    return ChunkContentResponse(
      id=chunk.get("id", chunk_id),
      text_content=chunk.get("text", ""),
    )

  except HTTPException:
    raise
  except Exception as e:
    logger.error(f"Failed to fetch chunk content for {chunk_id}: {e}")
    raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Job Endpoints
# ============================================================================
@app.get("/v1/job/{job_id}")
async def get_job(job_id: str, user: UserContext = Depends(require_role(Role.READONLY))):
  """Get the status of an ingestion job."""
  if not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")
  job_info = await jobmanager.get_job(job_id)
  if not job_info:
    raise HTTPException(status_code=404, detail="Job not found")

  logger.info(f"Returning job {job_info}")
  return job_info


@app.get("/v1/jobs/datasource/{datasource_id}")
async def get_jobs_by_datasource(datasource_id: str, status_filter: Optional[JobStatus] = None, user: UserContext = Depends(require_role(Role.READONLY))):
  """Get all jobs for a specific datasource, optionally filtered by status."""
  if not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")
  jobs = await jobmanager.get_jobs_by_datasource(datasource_id, status_filter=status_filter)
  if jobs is None:
    raise HTTPException(status_code=404, detail="No jobs found for the specified datasource")

  logger.info(f"Returning {len(jobs)} jobs for datasource {datasource_id}")
  return jobs


@app.post("/v1/jobs/batch")
async def get_jobs_batch(request: JobsBatchRequest, user: UserContext = Depends(require_role(Role.READONLY))):
  """Get jobs for multiple datasources in a single batch request.

  This endpoint is optimized for polling job statuses across multiple datasources,
  reducing the number of API calls and RBAC authentication overhead.
  """
  if not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  # Validate request
  if len(request.datasource_ids) > 100:
    raise HTTPException(status_code=400, detail="Cannot fetch jobs for more than 100 datasources at once")

  # Convert status filter strings to JobStatus enum if provided
  status_filter_enums = None
  if request.status_filter:
    try:
      status_filter_enums = [JobStatus(s) for s in request.status_filter]
    except ValueError as e:
      raise HTTPException(status_code=400, detail=f"Invalid status filter: {e}")

  # Fetch jobs in batch
  jobs_by_datasource = await jobmanager.get_jobs_batch(datasource_ids=request.datasource_ids, status_filter=status_filter_enums)

  # Count total jobs
  total_jobs = sum(len(jobs) for jobs in jobs_by_datasource.values())

  logger.debug(f"Returning {total_jobs} jobs for {len(request.datasource_ids)} datasources (batch)")

  return {"jobs": jsonable_encoder(jobs_by_datasource), "total_jobs": total_jobs, "datasource_count": len(request.datasource_ids)}


@app.post("/v1/job", status_code=status.HTTP_201_CREATED)
async def create_job(datasource_id: str, job_status: Optional[JobStatus] = None, message: Optional[str] = None, total: Optional[int] = None, user: UserContext = Depends(require_role(Role.INGESTONLY))):
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
  success = await jobmanager.upsert_job(job_id, status=job_status or JobStatus.PENDING, message=message or "Job created", total=total, datasource_id=datasource_id)

  if not success:
    raise HTTPException(status_code=400, detail="Failed to create job")

  logger.info(f"Created job {job_id} for datasource {datasource_id}")
  return {"job_id": job_id, "datasource_id": datasource_id}


@app.patch("/v1/job/{job_id}", status_code=status.HTTP_200_OK)
async def update_job(job_id: str, job_status: Optional[JobStatus] = None, message: Optional[str] = None, total: Optional[int] = None, user: UserContext = Depends(require_role(Role.INGESTONLY))):
  """Update an existing job."""
  if not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  # Check if job exists
  existing_job = await jobmanager.get_job(job_id)
  if not existing_job:
    raise HTTPException(status_code=404, detail="Job not found")

  # Update job
  success = await jobmanager.upsert_job(job_id, status=job_status, message=message, total=total, datasource_id=existing_job.datasource_id)

  if not success:
    raise HTTPException(status_code=400, detail="Failed to update job (job may be terminated)")

  logger.info(f"Updated job {job_id}")
  return {"job_id": job_id, "datasource_id": existing_job.datasource_id}


@app.post("/v1/job/{job_id}/terminate", status_code=status.HTTP_200_OK)
async def terminate_job_endpoint(job_id: str, user: UserContext = Depends(require_role(Role.ADMIN))):
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
async def increment_job_progress(job_id: str, increment: int = 1, user: UserContext = Depends(require_role(Role.INGESTONLY))):
  """Increment the progress counter for a job."""
  if not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  new_value = await jobmanager.increment_progress(job_id, increment)
  if new_value == -1:
    raise HTTPException(status_code=400, detail="Cannot increment progress - job is terminated")

  logger.debug(f"Incremented progress for job {job_id} by {increment}, new value: {new_value}")
  return {"job_id": job_id, "progress_counter": new_value}


@app.post("/v1/job/{job_id}/increment-failure")
async def increment_job_failure(job_id: str, increment: int = 1, user: UserContext = Depends(require_role(Role.INGESTONLY))):
  """Increment the failure counter for a job."""
  if not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  new_value = await jobmanager.increment_failure(job_id, increment)
  if new_value == -1:
    raise HTTPException(status_code=400, detail="Cannot increment failure - job is terminated")

  logger.debug(f"Incremented failure for job {job_id} by {increment}, new value: {new_value}")
  return {"job_id": job_id, "failed_counter": new_value}


@app.post("/v1/job/{job_id}/increment-document-count")
async def increment_job_document_count(job_id: str, increment: int = 1, user: UserContext = Depends(require_role(Role.INGESTONLY))):
  """Increment the document count for a job."""
  if not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  new_value = await jobmanager.increment_document_count(job_id, increment)
  if new_value == -1:
    raise HTTPException(status_code=400, detail="Cannot increment document count - job is terminated")

  logger.debug(f"Incremented document count for job {job_id} by {increment}, new value: {new_value}")
  return {"job_id": job_id, "document_count": new_value}


@app.post("/v1/job/{job_id}/add-errors")
async def add_job_errors(job_id: str, error_messages: List[str], user: UserContext = Depends(require_role(Role.INGESTONLY))):
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
# Ingestion Endpoints
# ============================================================================


@app.post("/v1/ingest/webloader/url", status_code=status.HTTP_202_ACCEPTED)
async def ingest_url(url_request: UrlIngestRequest, user: UserContext = Depends(require_role(Role.INGESTONLY))):
  """Queue a URL for ingestion by the webloader ingestor."""
  if not metadata_storage or not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  logger.info(f"Received URL ingestion request: {url_request.url}")

  # Sanitize URL
  sanitized_url = sanitize_url(url_request.url)
  url_request.url = sanitized_url

  # Generate datasource ID and create datasource
  datasource_id = utils.generate_datasource_id_from_url(url_request.url)

  # Check if datasource already exists (for web, each URL is unique)
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
    datasource_id=datasource_id,
  )

  if not success:
    raise HTTPException(status_code=500, detail="Failed to create job")

  logger.info(f"Created job {job_id} for datasource {datasource_id}")

  if not url_request.description:
    url_request.description = f"Web content from {url_request.url}"

  # Create datasource
  # Metadata schema for source_type="web": {"url_ingest_request": UrlIngestRequest, "reload_interval": int | None}
  datasource_info = DataSourceInfo(
    datasource_id=datasource_id,
    ingestor_id=generate_ingestor_id(WEBLOADER_INGESTOR_NAME, WEBLOADER_INGESTOR_TYPE),
    description=url_request.description,
    source_type="web",
    last_updated=int(time.time()),
    default_chunk_size=url_request.settings.chunk_size,
    default_chunk_overlap=url_request.settings.chunk_overlap,
    metadata={
      "url_ingest_request": url_request.model_dump(),
      "reload_interval": url_request.reload_interval,  # Top-level for easy access by IngestorBuilder
    },
  )

  await metadata_storage.store_datasource_info(datasource_info)
  logger.info(f"Created datasource: {datasource_id}")

  # Queue the request for the ingestor
  ingestor_request = IngestorRequest(ingestor_id=generate_ingestor_id(WEBLOADER_INGESTOR_NAME, WEBLOADER_INGESTOR_TYPE), command=WebIngestorCommand.INGEST_URL, payload=url_request.model_dump())

  # Push to Redis queue
  await redis_client.rpush(WEBLOADER_INGESTOR_REDIS_QUEUE, ingestor_request.model_dump_json())  # type: ignore
  logger.info(f"Queued URL ingestion request for {url_request.url} to {WEBLOADER_INGESTOR_REDIS_QUEUE}")

  return {"datasource_id": datasource_id, "job_id": job_id, "message": "URL ingestion request queued"}


@app.post("/v1/ingest/webloader/reload", status_code=status.HTTP_202_ACCEPTED)
async def reload_url(reload_request: UrlReloadRequest, user: UserContext = Depends(require_role(Role.INGESTONLY))):
  """Reloads a previously ingested URL by re-queuing it for ingestion."""
  if not metadata_storage or not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  # Fetch existing datasource
  datasource_info = await metadata_storage.get_datasource_info(reload_request.datasource_id)
  if not datasource_info:
    raise HTTPException(status_code=404, detail="Datasource not found")

  # Queue the request for the ingestor
  ingestor_request = IngestorRequest(ingestor_id=datasource_info.ingestor_id, command=WebIngestorCommand.RELOAD_DATASOURCE, payload=reload_request.model_dump())

  # Push to Redis queue
  await redis_client.rpush(WEBLOADER_INGESTOR_REDIS_QUEUE, ingestor_request.model_dump_json())  # type: ignore
  logger.info(f"Re-queued URL ingestion request for {reload_request.datasource_id}")
  return {"datasource_id": reload_request.datasource_id, "message": "URL reload ingestion request queued"}


@app.post("/v1/ingest/webloader/reload-all", status_code=status.HTTP_202_ACCEPTED)
async def reload_all_urls(user: UserContext = Depends(require_role(Role.ADMIN))):
  """Reloads all previously ingested URLs by re-queuing them for ingestion."""
  if not metadata_storage or not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  # Queue the request for the ingestor
  ingestor_request = IngestorRequest(ingestor_id=generate_ingestor_id(WEBLOADER_INGESTOR_NAME, WEBLOADER_INGESTOR_TYPE), command=WebIngestorCommand.RELOAD_ALL, payload={})

  # Push to Redis queue
  await redis_client.rpush(WEBLOADER_INGESTOR_REDIS_QUEUE, ingestor_request.model_dump_json())  # type: ignore
  logger.info("Re-queued URL ingestion request for all datasources")

  return {"message": "Reload all URLs request queued"}


@app.post("/v1/ingest/confluence/page", status_code=status.HTTP_202_ACCEPTED)
async def ingest_confluence_page(confluence_request: ConfluenceIngestRequest, user: UserContext = Depends(require_role(Role.INGESTONLY))):
  """Queue a Confluence page for ingestion by the confluence ingestor."""
  if not metadata_storage or not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  logger.info(f"Received Confluence page ingestion request: {confluence_request.url}")
  logger.info(f"  get_child_pages: {confluence_request.get_child_pages}")

  # Parse Confluence URL to extract space_key and page_id
  confluence_match = re.search(r"/spaces/([^/]+)/pages/(\d+)", confluence_request.url)
  if not confluence_match:
    raise HTTPException(status_code=400, detail="Invalid Confluence URL format. Expected: https://domain.atlassian.net/wiki/spaces/SPACE/pages/PAGE_ID/Title")

  space_key = confluence_match.group(1)
  page_id = confluence_match.group(2)

  # Validate that submitted URL matches configured Confluence instance
  if confluence_url:
    submitted_parsed = urlparse(confluence_request.url)
    configured_parsed = urlparse(confluence_url)

    # Compare scheme and netloc (domain)
    if submitted_parsed.scheme != configured_parsed.scheme or submitted_parsed.netloc != configured_parsed.netloc:
      raise HTTPException(status_code=400, detail=f"URL must be from configured Confluence instance: {configured_parsed.scheme}://{configured_parsed.netloc}")

  # Generate space-level datasource ID
  domain = urlparse(confluence_request.url).netloc.replace(".", "_").replace("-", "_")
  datasource_id = f"src_confluence___{domain}__{space_key}"

  # Build page config for this ingestion
  page_config = {"page_id": page_id, "source": confluence_request.url, "get_child_pages": confluence_request.get_child_pages}

  # Check if datasource already exists
  existing_datasource = await metadata_storage.get_datasource_info(datasource_id)
  if existing_datasource:
    if not existing_datasource.metadata:
      existing_datasource.metadata = {}
    page_configs = existing_datasource.metadata.get("page_configs", [])

    # Check if page already exists in configs
    existing_page_config = next((c for c in page_configs if c.get("page_id") == page_id), None)

    if existing_page_config:
      # Update the get_child_pages flag
      existing_page_config["get_child_pages"] = confluence_request.get_child_pages
      existing_page_config["source"] = confluence_request.url
      logger.info(f"Updated page {page_id} config in {datasource_id}")
    else:
      # Add new page config
      page_configs.append(page_config)
      logger.info(f"Added page {page_id} to {datasource_id}")

    existing_datasource.metadata["page_configs"] = page_configs
    # Update title filter patterns if provided
    if confluence_request.allowed_title_patterns is not None:
      existing_datasource.metadata["allowed_title_patterns"] = confluence_request.allowed_title_patterns
    if confluence_request.denied_title_patterns is not None:
      existing_datasource.metadata["denied_title_patterns"] = confluence_request.denied_title_patterns
    existing_datasource.metadata["confluence_ingest_request"] = confluence_request.model_dump()
    await metadata_storage.store_datasource_info(existing_datasource)
  else:
    # Create new datasource
    if not confluence_request.description:
      confluence_request.description = f"Confluence space {space_key}"

    confluence_url_base = confluence_request.url.split("/wiki/")[0] + "/wiki" if "/wiki/" in confluence_request.url else confluence_request.url

    datasource_info = DataSourceInfo(
      datasource_id=datasource_id,
      ingestor_id=generate_ingestor_id(CONFLUENCE_INGESTOR_NAME, CONFLUENCE_INGESTOR_TYPE),
      description=confluence_request.description,
      source_type="confluence",
      last_updated=int(time.time()),
      default_chunk_size=1000,
      default_chunk_overlap=200,
      metadata={
        "confluence_ingest_request": confluence_request.model_dump(),
        "space_key": space_key,
        "page_configs": [page_config],
        "confluence_url": confluence_url_base,
        **({"allowed_title_patterns": confluence_request.allowed_title_patterns} if confluence_request.allowed_title_patterns else {}),
        **({"denied_title_patterns": confluence_request.denied_title_patterns} if confluence_request.denied_title_patterns else {}),
      },
    )

    await metadata_storage.store_datasource_info(datasource_info)
    logger.info(f"Created datasource: {datasource_id}")

  # Check if there is already a job for this datasource in progress or pending
  existing_jobs = await jobmanager.get_jobs_by_datasource(datasource_id)
  if existing_jobs:
    existing_pending_jobs = [job for job in existing_jobs if job.status in (JobStatus.IN_PROGRESS, JobStatus.PENDING)]
    if existing_pending_jobs:
      logger.info(f"An ingestion job is already in progress or pending for datasource {datasource_id}, job ID: {existing_pending_jobs[0].job_id}")
      raise HTTPException(status_code=400, detail=f"An ingestion job is already in progress or pending for this Confluence space (job ID: {existing_pending_jobs[0].job_id})")

  # Create job with PENDING status
  job_id = str(uuid.uuid4())
  success = await jobmanager.upsert_job(
    job_id,
    status=JobStatus.PENDING,
    message="Waiting for ingestor to process...",
    total=1,  # Single page ingestion
    datasource_id=datasource_id,
  )

  if not success:
    raise HTTPException(status_code=500, detail="Failed to create job")

  logger.info(f"Created job {job_id} for datasource {datasource_id}")

  # Queue the request for the ingestor
  ingestor_request = IngestorRequest(ingestor_id=generate_ingestor_id(CONFLUENCE_INGESTOR_NAME, CONFLUENCE_INGESTOR_TYPE), command=ConfluenceIngestorCommand.INGEST_PAGE, payload=confluence_request.model_dump())

  # Push to Redis queue
  await redis_client.rpush(CONFLUENCE_INGESTOR_REDIS_QUEUE, ingestor_request.model_dump_json())  # type: ignore
  logger.info(f"Queued Confluence page ingestion request for {confluence_request.url} to {CONFLUENCE_INGESTOR_REDIS_QUEUE}")

  return {"datasource_id": datasource_id, "job_id": job_id, "message": "Confluence page ingestion request queued"}


@app.post("/v1/ingest/confluence/reload", status_code=status.HTTP_202_ACCEPTED)
async def reload_confluence_page(reload_request: ConfluenceReloadRequest, user: UserContext = Depends(require_role(Role.INGESTONLY))):
  """Reloads a previously ingested Confluence page by re-queuing it for ingestion."""
  if not metadata_storage or not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  # Fetch existing datasource
  datasource_info = await metadata_storage.get_datasource_info(reload_request.datasource_id)
  if not datasource_info:
    raise HTTPException(status_code=404, detail="Datasource not found")

  # Queue the request for the ingestor
  ingestor_request = IngestorRequest(ingestor_id=datasource_info.ingestor_id, command=ConfluenceIngestorCommand.RELOAD_DATASOURCE, payload=reload_request.model_dump())

  # Push to Redis queue
  await redis_client.rpush(CONFLUENCE_INGESTOR_REDIS_QUEUE, ingestor_request.model_dump_json())  # type: ignore
  logger.info(f"Re-queued Confluence page ingestion request for {reload_request.datasource_id}")
  return {"datasource_id": reload_request.datasource_id, "message": "Confluence page reload request queued"}


@app.post("/v1/ingest/confluence/reload-all", status_code=status.HTTP_202_ACCEPTED)
async def reload_all_confluence_pages(user: UserContext = Depends(require_role(Role.ADMIN))):
  """Reloads all previously ingested Confluence pages by re-queuing them for ingestion."""
  if not metadata_storage or not jobmanager:
    raise HTTPException(status_code=500, detail="Server not initialized")

  # Queue the request for the ingestor
  ingestor_request = IngestorRequest(ingestor_id=generate_ingestor_id(CONFLUENCE_INGESTOR_NAME, CONFLUENCE_INGESTOR_TYPE), command=ConfluenceIngestorCommand.RELOAD_ALL, payload={})

  # Push to Redis queue
  await redis_client.rpush(CONFLUENCE_INGESTOR_REDIS_QUEUE, ingestor_request.model_dump_json())  # type: ignore
  logger.info("Re-queued Confluence ingestion request for all datasources")

  return {"message": "Reload all Confluence pages request queued"}


@app.post("/v1/ingest")
async def ingest_documents(ingest_request: DocumentIngestRequest, user: UserContext = Depends(require_role(Role.INGESTONLY))):
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

  if ingest_request.fresh_until is None or ingest_request.fresh_until == 0:
    # Calculate fresh_until from datasource reload_interval
    ingest_request.fresh_until = get_fresh_until(datasource_info.reload_interval)

  if datasource_info.default_chunk_overlap is None:
    datasource_info.default_chunk_overlap = 0

  if datasource_info.default_chunk_size is None:
    datasource_info.default_chunk_size = 0  # Don't chunk if chunk size is not set

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
  except ValueError:
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"message": "Invalid input data"})
  return JSONResponse(status_code=status.HTTP_202_ACCEPTED, content={"message": "Text data ingestion started successfully"})


# ============================================================================
# Knowledge Graph Endpoints
# ============================================================================


@app.get("/v1/graph/explore/entity_type")
async def list_entity_types(user: UserContext = Depends(require_role(Role.READONLY))):
  """
  Lists all entity types in the database
  """
  if not ontology_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")
  logger.debug("Listing entity types")
  e = await ontology_graph_db.get_all_entity_types()
  return JSONResponse(status_code=status.HTTP_200_OK, content=e)


# ====
# Data Graph Endpoints
# ====
@app.get("/v1/graph/explore/data/entities/batch")
async def fetch_data_entities_batch(
  offset: int = Query(0, description="Number of entities to skip (for pagination)", ge=0),
  limit: int = Query(100, description="Maximum number of entities to return", ge=1, le=1000),
  entity_type: Optional[str] = Query(None, description="Optional filter by entity type"),
  user: UserContext = Depends(require_role(Role.READONLY)),
):
  """
  Fetch entities from the data graph in batches for efficient bulk processing.
  Useful for pagination and bulk export of graph data.
  Maximum limit is 1000 entities per request.
  """
  if not data_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

  # Enforce max limit of 1000
  if limit > 1000:
    raise HTTPException(status_code=400, detail="Limit cannot exceed 1000 entities per request")

  logger.debug(f"Fetching data entities batch: offset={offset}, limit={limit}, entity_type={entity_type}")

  entities = await data_graph_db.fetch_entities_batch(offset=offset, limit=limit, entity_type=entity_type)

  return JSONResponse(status_code=status.HTTP_200_OK, content={"entities": jsonable_encoder(entities), "count": len(entities), "offset": offset, "limit": limit})


@app.get("/v1/graph/explore/data/relations/batch")
async def fetch_data_relations_batch(
  offset: int = Query(0, description="Number of relations to skip (for pagination)", ge=0),
  limit: int = Query(100, description="Maximum number of relations to return", ge=1, le=1000),
  relation_name: Optional[str] = Query(None, description="Optional filter by relation name"),
  user: UserContext = Depends(require_role(Role.READONLY)),
):
  """
  Fetch relations from the data graph in batches for efficient bulk processing.
  Useful for pagination and bulk export of graph relations.
  Maximum limit is 1000 relations per request.
  """
  if not data_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

  # Enforce max limit of 1000
  if limit > 1000:
    raise HTTPException(status_code=400, detail="Limit cannot exceed 1000 relations per request")

  logger.debug(f"Fetching data relations batch: offset={offset}, limit={limit}, relation_name={relation_name}")

  relations = await data_graph_db.fetch_relations_batch(offset=offset, limit=limit, relation_name=relation_name)

  return JSONResponse(status_code=status.HTTP_200_OK, content={"relations": jsonable_encoder(relations), "count": len(relations), "offset": offset, "limit": limit})


@app.post("/v1/graph/explore/data/entity/neighborhood")
async def explore_data_entity_neighborhood(request: ExploreNeighborhoodRequest, user: UserContext = Depends(require_role(Role.READONLY))):
  """
  Explore an entity and its neighborhood in the data graph up to a specified depth.
  Depth 0 returns just the entity, depth 1 includes direct neighbors, etc.
  """
  if not data_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

  logger.debug(f"Exploring data neighborhood for entity_type={request.entity_type}, entity_pk={request.entity_pk}, depth={request.depth}")

  result = await data_graph_db.explore_neighborhood(entity_type=request.entity_type, entity_pk=request.entity_pk, depth=request.depth, max_results=1000)

  if result["entity"] is None:
    return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"message": "Entity not found"})

  return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(result))


@app.get("/v1/graph/explore/data/entity/start")
async def get_random_start_nodes(n: int = Query(10, description="Number of random nodes to fetch", ge=1, le=100), user: UserContext = Depends(require_role(Role.READONLY))):
  """
  Fetch random starting nodes from the data graph.
  Useful for initializing graph visualization or exploration.
  """
  if not data_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

  logger.debug(f"Fetching {n} random nodes from data graph")

  entities = await data_graph_db.fetch_random_entities(count=n)

  return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(entities))


@app.get("/v1/graph/explore/data/stats")
async def get_data_graph_stats(user: UserContext = Depends(require_role(Role.READONLY))):
  """
  Get statistics about the data graph (node count, relation count).
  """
  if not data_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

  logger.debug("Fetching data graph statistics")

  stats = await data_graph_db.get_graph_stats()

  return JSONResponse(status_code=status.HTTP_200_OK, content=stats)


# ====
# Ontology Graph Endpoints
# ====


@app.get("/v1/graph/explore/ontology/entities/batch")
async def fetch_ontology_entities_batch(
  offset: int = Query(0, description="Number of entities to skip (for pagination)", ge=0),
  limit: int = Query(100, description="Maximum number of entities to return", ge=1, le=1000),
  entity_type: Optional[str] = Query(None, description="Optional filter by entity type"),
  user: UserContext = Depends(require_role(Role.READONLY)),
):
  """
  Fetch entities from the ontology graph in batches for efficient bulk processing.
  Useful for pagination and bulk export of ontology data.
  Maximum limit is 1000 entities per request.
  """
  if not ontology_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

  # Enforce max limit of 1000
  if limit > 1000:
    raise HTTPException(status_code=400, detail="Limit cannot exceed 1000 entities per request")

  logger.debug(f"Fetching ontology entities batch: offset={offset}, limit={limit}, entity_type={entity_type}")

  entities = await ontology_graph_db.fetch_entities_batch(offset=offset, limit=limit, entity_type=entity_type)

  return JSONResponse(status_code=status.HTTP_200_OK, content={"entities": jsonable_encoder(entities), "count": len(entities), "offset": offset, "limit": limit})


@app.get("/v1/graph/explore/ontology/relations/batch")
async def fetch_ontology_relations_batch(
  offset: int = Query(0, description="Number of relations to skip (for pagination)", ge=0),
  limit: int = Query(100, description="Maximum number of relations to return", ge=1, le=1000),
  relation_name: Optional[str] = Query(None, description="Optional filter by relation name"),
  user: UserContext = Depends(require_role(Role.READONLY)),
):
  """
  Fetch relations from the ontology graph in batches for efficient bulk processing.
  Useful for pagination and bulk export of ontology relations.
  Maximum limit is 1000 relations per request.
  """
  if not ontology_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

  # Enforce max limit of 1000
  if limit > 1000:
    raise HTTPException(status_code=400, detail="Limit cannot exceed 1000 relations per request")

  logger.debug(f"Fetching ontology relations batch: offset={offset}, limit={limit}, relation_name={relation_name}")

  relations = await ontology_graph_db.fetch_relations_batch(offset=offset, limit=limit, relation_name=relation_name)

  return JSONResponse(status_code=status.HTTP_200_OK, content={"relations": jsonable_encoder(relations), "count": len(relations), "offset": offset, "limit": limit})


@app.post("/v1/graph/explore/ontology/entity/neighborhood")
async def explore_ontology_entity_neighborhood(request: ExploreNeighborhoodRequest, user: UserContext = Depends(require_role(Role.READONLY))):
  """
  Explore an entity and its neighborhood in the ontology graph up to a specified depth.
  Depth 0 returns just the entity, depth 1 includes direct neighbors, etc.
  """
  if not ontology_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

  logger.debug(f"Exploring ontology neighborhood for entity_type={request.entity_type}, entity_pk={request.entity_pk}, depth={request.depth}")

  result = await ontology_graph_db.explore_neighborhood(entity_type=request.entity_type, entity_pk=request.entity_pk, depth=request.depth, max_results=1000)

  if result["entity"] is None:
    return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"message": "Entity not found"})

  return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(result))


@app.get("/v1/graph/explore/ontology/entity/start")
async def get_random_ontology_start_nodes(n: int = Query(10, description="Number of random nodes to fetch", ge=1, le=100), user: UserContext = Depends(require_role(Role.READONLY))):
  """
  Fetch random starting nodes from the ontology graph.
  Useful for initializing graph visualization or exploration.
  """
  if not ontology_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

  logger.debug(f"Fetching {n} random nodes from ontology graph")

  entities = await ontology_graph_db.fetch_random_entities(count=n)

  return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(entities))


@app.get("/v1/graph/explore/ontology/stats")
async def get_ontology_graph_stats(user: UserContext = Depends(require_role(Role.READONLY))):
  """
  Get statistics about the ontology graph (node count, relation count).
  """
  if not ontology_graph_db:
    raise HTTPException(status_code=500, detail="Server not initialized, or graph RAG is disabled")

  logger.debug("Fetching ontology graph statistics")

  stats = await ontology_graph_db.get_graph_stats()

  return JSONResponse(status_code=status.HTTP_200_OK, content=stats)


# ====
# Ontology Agent Reverse Proxy
# ====
async def _reverse_proxy(request: Request):
  """
  Reverse proxy to ontology agent service, which runs a separate FastAPI instance,
  and is responsible for handling ontology related requests.

  Read-only operations (GET /status) require READONLY role.
  Write operations (POST/DELETE) require ADMIN role.

  This acts as a security gateway - the ontology agent service doesn't need
  its own RBAC implementation since it's only accessible through this proxy.
  """
  # Manually invoke the RBAC check since app.add_route doesn't support Depends()
  # We must manually resolve the auth_manager since Depends() doesn't work here
  auth_manager = get_auth_manager()
  user = await get_user_or_anonymous(request, auth_manager)

  # Determine required role based on method and path
  # GET /status endpoints are read-only, allow READONLY access
  # All other operations (POST/DELETE) require ADMIN
  is_status_endpoint = request.url.path.endswith("/status")
  is_read_only = request.method == "GET" and is_status_endpoint

  required_role = Role.READONLY if is_read_only else Role.ADMIN

  if not has_permission(user.role, required_role):
    raise HTTPException(status_code=403, detail=f"Insufficient permissions. Required role: {required_role}, your role: {user.role}")

  logger.info(f"Ontology agent request by {user.email} to {request.url.path}")

  url = httpx.URL(path=request.url.path, query=request.url.query.encode("utf-8"))
  rp_req = ontology_agent_client.build_request(request.method, url, headers=request.headers.raw, content=request.stream(), timeout=30.0)
  rp_resp = await ontology_agent_client.send(rp_req, stream=True)
  return StreamingResponse(
    rp_resp.aiter_raw(),
    status_code=rp_resp.status_code,
    headers=rp_resp.headers,
    background=BackgroundTask(rp_resp.aclose),
  )


if graph_rag_enabled:  # Only add reverse proxy if graph RAG is enabled
  app.add_route("/v1/graph/ontology/agent/{path:path}", _reverse_proxy, ["GET", "POST", "DELETE"])


# ============================================================================
# Health Check and Configuration Endpoint
# ============================================================================


@app.get("/healthz")
async def health_check():
  """Health check endpoint."""
  health_status = "healthy"
  health_details = {}

  # Check if services are initialized
  if not metadata_storage or not vector_db or not jobmanager or not redis_client or (graph_rag_enabled and (not data_graph_db or not ontology_graph_db)):
    health_status = "unhealthy"
    health_details["error"] = "One or more services are not initialized"
    logger.error("healthz: One or more services are not initialized")

  config = {
    "graph_rag_enabled": graph_rag_enabled,
    "cleanup": {
      "enabled": cleanup_enabled,
      "interval_seconds": clean_up_interval,
      "last_cleanup": last_cleanup_timestamp,
    },
    "search": {
      "keys": valid_metadata_keys(),
      "filter_keys": valid_metadata_keys_with_types(),
    },
    "vector_db": {"milvus": {"uri": milvus_uri, "collections": [default_collection_name_docs], "index_params": {"dense": dense_index_params, "sparse": sparse_index_params}}},
    "embeddings": {"model": embeddings_model},
    "metadata_storage": {"redis": {"url": redis_url}},
    "ui_url": ui_url,
  }

  if graph_rag_enabled:
    if data_graph_db and ontology_graph_db:
      config["graph_db"] = {
        "data_graph": {"type": data_graph_db.database_type, "query_language": data_graph_db.query_language, "uri": neo4j_addr, "tenant_label": data_graph_db.tenant_label},
        "ontology_graph": {"type": ontology_graph_db.database_type, "query_language": ontology_graph_db.query_language, "uri": neo4j_addr, "tenant_label": ontology_graph_db.tenant_label},
        "structured_entity_types": await data_graph_db.get_all_entity_types() if data_graph_db else [],
      }

  response = {"status": health_status, "timestamp": int(time.time()), "details": health_details, "config": config}
  return response


async def init_tests(logger: logging.Logger, redis_client: redis.Redis, embeddings: EmbeddingsFactory, milvus_uri: str):
  """
  Run initial tests to ensure connections to check if deps are working.
  Note: This does not check the graph db connection as its done in the init of the class.
  """
  logger.info("====== Running initialization tests ======")
  logger.info(f"1. Testing connections to Redis: URI [{redis_url}]...")
  resp = await redis_client.ping()
  logger.info(f"Redis ping response: {resp}")

  # Test embeddings endpoint
  logger.info(f"2. Testing connections to [{embeddings_model}]...")
  resp = embeddings.get_embeddings().embed_documents(["Test document"])
  logger.info(f"Embeddings response: {resp}")

  # Test vector DB connections
  logger.info(f"3. Testing connections to Milvus: [{milvus_uri}]...")
  client = MilvusClient(uri=milvus_uri)
  logger.info("4. Listing Milvus collections")
  collections = client.list_collections()
  logger.info(f"Milvus collections: {collections}")

  test_collection_name = "test_collection"

  # Setup vector db for graph data
  vector_db_test = Milvus(
    embedding_function=embeddings.get_embeddings(), collection_name=test_collection_name, connection_args=milvus_connection_args, index_params=[dense_index_params, sparse_index_params], builtin_function=BM25BuiltInFunction(output_field_names="sparse"), vector_field=["dense", "sparse"]
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
  test_embedding = embeddings.get_embeddings().embed_documents(["test"])
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
    fields = collection_info.get("fields", [])
    field_names = {field["name"] for field in fields}

    # Check 1: Validate embedding dimensions
    logger.info(f"11a. Validating embedding dimensions for collection {collection_name}...")
    dense_field = next((field for field in fields if field["name"] == "dense"), None)
    if dense_field:
      actual_dim = dense_field["params"].get("dim")
      if actual_dim != expected_dim:
        raise Exception(f"Collection {collection_name}: Dense vector dimension mismatch. Expected: {expected_dim}, Actual: {actual_dim}, Have you changed the embeddings model? Please delete and re-ingest the collection.")
      logger.info(f"✓ Collection {collection_name}: Dense vector dimension correct ({actual_dim})")
    else:
      raise Exception(f"Collection {collection_name}: Dense vector field not found, please delete and re-ingest the collection.")

    # Check 2: Validate vector fields exists
    logger.info(f"11b. Validating vector fields for collection {collection_name}...")
    sparse_field = next((field for field in fields if field["name"] == "sparse"), None)
    if not sparse_field:
      raise Exception(f"Collection {collection_name}: Sparse vector field not found")

    # Validate required vector fields exist
    if "dense" not in field_names or "sparse" not in field_names:
      raise Exception(f"Collection {collection_name}: Missing required vector fields (dense, sparse), please delete and re-ingest the collection.")
    logger.info(f"✓ Collection {collection_name}: Vector fields present")

    if not collection_info.get("enable_dynamic_field"):
      raise Exception(f"Collection {collection_name}: Dynamic fields not enabled, please delete and re-ingest the collection.")

    logger.info(f"✓ Collection {collection_name}: Dynamic fields enabled")
    logger.info(f"✓ Collection {collection_name}: Metadata fields will be stored dynamically")

  logger.info("====== Initialization tests completed successfully ======")
  return


# ============================================================================
# MCP Tool Configuration Endpoints
# ============================================================================


async def _reload_mcp_tools():
  """Reload MCP tools from the current Redis config. No-op if MCP is disabled."""
  if not mcp_enabled or agent_tools is None:
    return
  builtin_config = await metadata_storage.get_mcp_builtin_config() or MCPBuiltinToolsConfig()
  tool_configs = await metadata_storage.fetch_all_mcp_tool_configs()
  await agent_tools.reload_tools(mcp, graph_rag_enabled=graph_rag_enabled, builtin_config=builtin_config, tool_configs=tool_configs)


@app.get("/v1/mcp/custom-tools", tags=["MCP Tools"])
async def list_mcp_tools(user: UserContext = Depends(require_role(Role.READONLY))):
  """List all custom MCP search tool configurations."""
  if not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")
  tools = await metadata_storage.fetch_all_mcp_tool_configs()
  return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(tools))


@app.post("/v1/mcp/custom-tools", tags=["MCP Tools"])
async def create_mcp_tool(config: MCPToolConfig, user: UserContext = Depends(require_role(Role.ADMIN))):
  """Create a new custom MCP search tool. The tool_id must be unique and not reserved."""
  if not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")
  if config.tool_id in RESERVED_TOOL_IDS:
    raise HTTPException(status_code=409, detail=f"tool_id '{config.tool_id}' conflicts with a built-in tool name and cannot be used.")
  existing = await metadata_storage.get_mcp_tool_config(config.tool_id)
  if existing:
    raise HTTPException(status_code=409, detail=f"A tool with tool_id '{config.tool_id}' already exists. Use PUT to update it.")
  now = int(time.time())
  config.created_at = now
  config.updated_at = now
  await metadata_storage.store_mcp_tool_config(config)
  logger.info(f"Created MCP tool '{config.tool_id}' (by {user.email})")
  await _reload_mcp_tools()
  return JSONResponse(status_code=status.HTTP_201_CREATED, content=jsonable_encoder(config))


@app.put("/v1/mcp/custom-tools/{tool_id}", tags=["MCP Tools"])
async def update_mcp_tool(tool_id: str, config: MCPToolConfig, user: UserContext = Depends(require_role(Role.ADMIN))):
  """Update an existing MCP search tool configuration (including the seeded 'search' tool)."""
  if not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")
  if tool_id in RESERVED_TOOL_IDS:
    raise HTTPException(status_code=409, detail=f"tool_id '{tool_id}' conflicts with a built-in tool name and cannot be managed here.")
  existing = await metadata_storage.get_mcp_tool_config(tool_id)
  if not existing:
    raise HTTPException(status_code=404, detail=f"MCP tool '{tool_id}' not found.")
  if config.tool_id != tool_id:
    raise HTTPException(status_code=400, detail="tool_id in the body must match the path parameter.")
  config.created_at = existing.created_at
  config.updated_at = int(time.time())
  await metadata_storage.store_mcp_tool_config(config)
  logger.info(f"Updated MCP tool '{tool_id}' (by {user.email})")
  await _reload_mcp_tools()
  return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(config))


@app.delete("/v1/mcp/custom-tools/{tool_id}", tags=["MCP Tools"])
async def delete_mcp_tool(tool_id: str, user: UserContext = Depends(require_role(Role.ADMIN))):
  """Delete a custom MCP search tool. Reserved tool IDs (e.g. 'search') cannot be deleted."""
  if not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")
  if tool_id in RESERVED_TOOL_IDS:
    raise HTTPException(status_code=409, detail=f"tool_id '{tool_id}' is a built-in tool and cannot be deleted.")
  existing = await metadata_storage.get_mcp_tool_config(tool_id)
  if not existing:
    raise HTTPException(status_code=404, detail=f"MCP tool '{tool_id}' not found.")
  await metadata_storage.delete_mcp_tool_config(tool_id)
  logger.info(f"Deleted MCP tool '{tool_id}' (by {user.email})")
  await _reload_mcp_tools()
  return JSONResponse(status_code=status.HTTP_200_OK, content={"message": f"MCP tool '{tool_id}' deleted."})


@app.get("/v1/mcp/builtin-tools", tags=["MCP Tools"])
async def get_mcp_builtin_config(user: UserContext = Depends(require_role(Role.READONLY))):
  """Get the built-in MCP tools enable/disable configuration."""
  if not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")
  config = await metadata_storage.get_mcp_builtin_config() or MCPBuiltinToolsConfig()
  return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(config))


@app.put("/v1/mcp/builtin-tools", tags=["MCP Tools"])
async def update_mcp_builtin_config(config: MCPBuiltinToolsConfig, user: UserContext = Depends(require_role(Role.ADMIN))):
  """Update the built-in MCP tools enable/disable toggles (fetch_document, fetch_datasources, graph_tools)."""
  if not metadata_storage:
    raise HTTPException(status_code=500, detail="Server not initialized")
  await metadata_storage.store_mcp_builtin_config(config)
  logger.info(f"Updated MCPBuiltinToolsConfig (by {user.email}): {config}")
  await _reload_mcp_tools()
  return JSONResponse(status_code=status.HTTP_200_OK, content=jsonable_encoder(config))


@app.get("/v1/mcp/tools/schema", tags=["MCP Tools"])
async def get_mcp_tool_schemas(user: UserContext = Depends(require_role(Role.READONLY))):
  """
  Get all registered MCP tools with their full JSON schemas.

  Returns both built-in tools (search, fetch_document, list_datasources_and_entity_types)
  and custom search tools. Each tool includes its full parameter schema for dynamic
  form generation in the UI.

  This endpoint is useful for:
  - Building dynamic search forms in the UI
  - Discovering available MCP tools and their parameters
  - Debugging/simulating MCP tool invocations via REST
  """
  if not mcp_enabled:
    raise HTTPException(status_code=400, detail="MCP is not enabled")
  if not agent_tools:
    raise HTTPException(status_code=500, detail="MCP tools not initialized")

  # Get all registered tools from FastMCP
  registered_tools = await mcp.list_tools()

  tools_with_schemas = []
  for tool in registered_tools:
    tools_with_schemas.append(
      {
        "name": tool.name,
        "description": tool.description or "",
        "parameters": tool.parameters,  # Full JSON schema
      }
    )

  return JSONResponse(
    status_code=status.HTTP_200_OK,
    content={"tools": tools_with_schemas, "count": len(tools_with_schemas)},
  )


@app.post("/v1/mcp/invoke", response_model=MCPToolInvokeResponse, tags=["MCP Tools"])
async def invoke_mcp_tool(request: MCPToolInvokeRequest, user: UserContext = Depends(require_role(Role.READONLY))):
  """
  Invoke an MCP tool via REST API.

  This endpoint allows invoking any registered MCP tool directly via REST,
  useful for debugging, testing, and UI integration without needing a full
  MCP client connection.

  The arguments must match the tool's parameter schema (see /v1/mcp/tools/schema).
  """
  if not mcp_enabled:
    raise HTTPException(status_code=400, detail="MCP is not enabled")
  if not agent_tools:
    raise HTTPException(status_code=500, detail="MCP tools not initialized")

  # Find the tool
  registered_tools = await mcp.list_tools()
  tool = next((t for t in registered_tools if t.name == request.tool_name), None)

  if not tool:
    raise HTTPException(status_code=404, detail=f"MCP tool '{request.tool_name}' not found")

  try:
    # Invoke the tool using tool.run()
    result = await tool.run(request.arguments)

    # Extract the raw result from ToolResult.content
    # Each content block has a .text attribute containing JSON-encoded data
    # We parse and return the first content block's data as-is
    raw_result = None
    if result.content:
      first_content = result.content[0]
      if hasattr(first_content, "text"):
        try:
          import json

          raw_result = json.loads(first_content.text)
        except (json.JSONDecodeError, TypeError):
          raw_result = first_content.text
      elif isinstance(first_content, dict) and "text" in first_content:
        try:
          import json

          raw_result = json.loads(first_content["text"])
        except (json.JSONDecodeError, TypeError):
          raw_result = first_content["text"]
      else:
        raw_result = str(first_content)

    return MCPToolInvokeResponse(
      tool_name=request.tool_name,
      success=True,
      result=raw_result,
      error=None,
    )
  except Exception as e:
    logger.error(f"Error invoking MCP tool '{request.tool_name}': {e}")
    return MCPToolInvokeResponse(
      tool_name=request.tool_name,
      success=False,
      result=None,
      error=str(e),
    )
