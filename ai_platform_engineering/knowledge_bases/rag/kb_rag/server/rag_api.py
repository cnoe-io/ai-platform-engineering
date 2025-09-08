import datetime
from fastapi import FastAPI, UploadFile, status, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import logging
import os
import json
from langchain_milvus import Milvus
from langchain_core.vectorstores import VectorStore
from kb_rag.server.loader.loader import Loader
from langchain_openai import AzureOpenAIEmbeddings
from langchain_core.documents import Document
import dotenv
import uuid
from enum import Enum
import redis.asyncio as redis
from contextlib import asynccontextmanager

dotenv.load_dotenv()

# Initialize logger
logger = logging.getLogger("uvicorn")
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))

# Initialize Redis client
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
redis_client = redis.from_url(redis_url, encoding="utf-8", decode_responses=True)

# Lifespan event handler
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan events"""
    # Startup
    try:
        await redis_client.ping()
        logger.info("Successfully connected to Redis")
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")

    yield

    # Shutdown
    if loader is not None:
        await loader.close()
    await redis_client.close()

# Initialize FastAPI app
app = FastAPI(
    title="RAG API",
    description="A RAG (Retrieval-Augmented Generation) API for managing collections, sources, documents, chunks, and queries",
    version="1.0.0",
    lifespan=lifespan,
)

# Job tracking
class JobStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"

class JobInfo(BaseModel):
    job_id: str
    status: JobStatus
    progress: Dict[str, Any] = {}
    created_at: datetime.datetime
    completed_at: Optional[datetime.datetime] = None
    error: Optional[str] = None

# Collection configuration
class CollectionConfig(BaseModel):
    collection_name: str = Field(..., description="Name of the collection")
    url: Optional[str] = Field(None, description="Source URL for the collection")
    chunk_size: int = Field(10000, description="Size of text chunks", ge=100, le=50000)
    chunk_overlap: int = Field(2000, description="Overlap between chunks", ge=0, le=5000)
    created_at: datetime.datetime = Field(..., description="When the configuration was first created")
    last_updated: datetime.datetime = Field(..., description="When the configuration was last updated")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class ConfigRequest(BaseModel):
    collection_name: str = Field(..., description="Collection name")
    url: Optional[str] = Field(None, description="Source URL")
    chunk_size: int = Field(10000, description="Size of text chunks", ge=100, le=50000)
    chunk_overlap: int = Field(2000, description="Overlap between chunks", ge=0, le=5000)
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class ConfigResponse(BaseModel):
    success: bool
    message: str
    config: Optional[CollectionConfig] = None

# Initialize embeddings
embeddings = AzureOpenAIEmbeddings(model=os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-large"))

# Milvus connection parameters
milvus_connection_args = {"uri": os.getenv("MILVUS_URI", "http://milvus-standalone:19530")}
milvus_index_params = {"index_type": "HNSW", "metric_type": "L2"}

def get_vector_db(collection_name: str = None) -> VectorStore:
    """Get or create a Milvus vector database for the specified collection"""
    if not collection_name:
        collection_name = os.getenv("DEFAULT_VSTORE_COLLECTION", "rag_default")

    return Milvus(
        embedding_function=embeddings,
        collection_name=collection_name,
        connection_args=milvus_connection_args,
        index_params=milvus_index_params,
    )

# Initialize default vector database (lazy initialization)
vector_db: VectorStore = None

# Initialize loader with Redis client (will be set up lazily)
loader = None

def get_loader():
    """Get or create the loader instance"""
    global loader
    if loader is None:
        global vector_db
        if vector_db is None:
            vector_db = get_vector_db()
        loader = Loader(vector_db, logger, redis_client)
    return loader

# Redis helper functions
async def store_job_info(job_id: str, job_info: JobInfo):
    """Store job information in Redis"""
    await redis_client.setex(
        f"job:{job_id}",
        3600,  # 1 hour expiry
        json.dumps(job_info.model_dump(), default=str)
    )

async def get_job_info(job_id: str) -> Optional[JobInfo]:
    """Retrieve job information from Redis"""
    job_data = await redis_client.get(f"job:{job_id}")
    if job_data:
        data = json.loads(job_data)
        # Convert string dates back to datetime objects
        data['created_at'] = datetime.datetime.fromisoformat(data['created_at'])
        if data.get('completed_at'):
            data['completed_at'] = datetime.datetime.fromisoformat(data['completed_at'])
        return JobInfo(**data)
    return None

async def store_collection_config(config: CollectionConfig):
    """Store collection configuration in Redis"""
    config_data = config.model_dump(mode='json')
    # Store by collection name and by URL (if provided)
    collection_key = f"config:collection:{config.collection_name}"
    await redis_client.setex(
        collection_key,
        86400 * 7,  # 7 days expiry
        json.dumps(config_data, default=str)
    )
    logger.info(f"Stored config with collection key: {collection_key}")

    if config.url:
        url_key = f"config:url:{config.url}"
        await redis_client.setex(
            url_key,
            86400 * 7,  # 7 days expiry
            json.dumps(config_data, default=str)
        )
        logger.info(f"Stored config with URL key: {url_key}")

async def get_collection_config(identifier: str, by_url: bool = False) -> Optional[CollectionConfig]:
    """Retrieve collection configuration from Redis by collection name or URL"""
    key = f"config:url:{identifier}" if by_url else f"config:collection:{identifier}"
    config_data = await redis_client.get(key)
    if config_data:
        data = json.loads(config_data)
        # Convert string dates back to datetime objects
        data['created_at'] = datetime.datetime.fromisoformat(data['created_at'])
        data['last_updated'] = datetime.datetime.fromisoformat(data['last_updated'])
        return CollectionConfig(**data)
    return None

async def list_all_collections() -> List[str]:
    """List all stored collection names"""
    keys = await redis_client.keys("config:collection:*")
    return [key.replace("config:collection:", "") for key in keys]


# ============================================================================
# Pydantic Models (keeping existing ones)
# ============================================================================

class UrlIngest(BaseModel):
    url: str = Field(..., description="URL to ingest")
    collection_name: Optional[str] = Field(None, description="Custom collection name")
    params: Optional[Dict[str, Any]] = Field(None, description="Additional parameters")

class FileIngest(BaseModel):
    file: UploadFile = Field(..., description="File to ingest")
    params: Optional[Dict[str, Any]] = Field(None, description="Additional parameters")

class QueryRequest(BaseModel):
    query: str = Field(..., description="Query string to search for")
    limit: int = Field(3, description="Maximum number of results to return", ge=1, le=100)
    similarity_threshold: float = Field(0.7, description="Minimum similarity score", ge=0.0, le=1.0)
    collection_name: Optional[str] = Field(None, description="Collection to query (defaults to rag_default)")

class QueryResult(BaseModel):
    query: str
    results: List[Document]

class IngestResponse(BaseModel):
    job_id: str
    status: str
    message: str

# ============================================================================
# Configuration Endpoints
# ============================================================================

@app.post("/v1/config", response_model=ConfigResponse)
async def set_collection_config(config_request: ConfigRequest):
    """Set configuration for a collection"""
    try:
        # Check if configuration already exists to preserve created_at timestamp
        existing_config = None
        if config_request.url:
            existing_config = await get_collection_config(config_request.url, by_url=True)
        if not existing_config:
            existing_config = await get_collection_config(config_request.collection_name, by_url=False)

        # Create new config, preserving created_at if it exists
        current_time = datetime.datetime.now(datetime.timezone.utc)
        config = CollectionConfig(
            collection_name=config_request.collection_name,
            url=config_request.url,
            chunk_size=config_request.chunk_size,
            chunk_overlap=config_request.chunk_overlap,
            metadata=config_request.metadata,
            created_at=existing_config.created_at if existing_config else current_time,
            last_updated=current_time
        )
        await store_collection_config(config)
        logger.info(f"Stored configuration for collection: {config.collection_name}")

        return ConfigResponse(
            success=True,
            message="Configuration saved successfully",
            config=config
        )
    except Exception as e:
        logger.error(f"Failed to store configuration: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/config/collection/{collection_name}", response_model=ConfigResponse)
async def get_collection_config_by_name(collection_name: str):
    """Get configuration for a collection by name"""
    try:
        config = await get_collection_config(collection_name, by_url=False)
        if not config:
            raise HTTPException(status_code=404, detail="Collection configuration not found")

        return ConfigResponse(
            success=True,
            message="Configuration retrieved successfully",
            config=config
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to retrieve configuration: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/config/url", response_model=ConfigResponse)
async def get_collection_config_by_url(url: str):
    """Get configuration for a collection by URL"""
    try:
        logger.info(f"Looking up configuration for URL: {url}")

        config = await get_collection_config(url, by_url=True)
        if not config:
            logger.info(f"No configuration found for URL: {url}")
            # Check what keys exist in Redis for debugging
            all_url_keys = await redis_client.keys("config:url:*")
            logger.info(f"Available URL keys in Redis: {all_url_keys}")
            raise HTTPException(status_code=404, detail="URL configuration not found")

        logger.info(f"Found configuration for URL: {url}")
        return ConfigResponse(
            success=True,
            message="Configuration retrieved successfully",
            config=config
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to retrieve configuration: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/config/collections")
async def list_collections():
    """List all stored collection names"""
    try:
        collections = await list_all_collections()
        return {
            "success": True,
            "collections": collections,
            "count": len(collections)
        }
    except Exception as e:
        logger.error(f"Failed to list collections: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/debug/redis-keys")
async def debug_redis_keys():
    """Debug endpoint to see all Redis keys (for development)"""
    try:
        config_keys = await redis_client.keys("config:*")
        job_keys = await redis_client.keys("job:*")

        return {
            "config_keys": config_keys,
            "job_keys": job_keys,
            "total_keys": len(config_keys) + len(job_keys)
        }
    except Exception as e:
        logger.error(f"Failed to get Redis keys: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/debug/test-config")
async def test_config_save(url: str):
    """Debug endpoint to manually save a test configuration"""
    try:
        current_time = datetime.datetime.now(datetime.timezone.utc)
        config = CollectionConfig(
            collection_name="debug-test",
            url=url,
            chunk_size=10000,
            chunk_overlap=2000,
            created_at=current_time,
            last_updated=current_time
        )
        await store_collection_config(config)

        return {
            "success": True,
            "message": f"Test configuration saved for URL: {url}",
            "config": config
        }
    except Exception as e:
        logger.error(f"Failed to save test configuration: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# Datasources Endpoints (Updated)
# ============================================================================

async def run_ingestion_with_progress(url: str, job_id: str, collection_name: Optional[str] = None):
    """Wrapper function to run ingestion with proper job tracking"""
    try:
        # Get collection configuration if it exists
        config = None
        if collection_name:
            config = await get_collection_config(collection_name, by_url=False)
        if not config and url:
            config = await get_collection_config(url, by_url=True)

        # Determine the actual collection name to use
        actual_collection_name = collection_name or "rag_default"
        if config:
            actual_collection_name = config.collection_name
            logger.info(f"Using configuration for ingestion: collection={actual_collection_name}, chunk_size={config.chunk_size}, chunk_overlap={config.chunk_overlap}")
            current_loader = get_loader()
            current_loader.set_chunking_config(config.chunk_size, config.chunk_overlap)

        # Get the appropriate vector database for this collection
        collection_vector_db = get_vector_db(actual_collection_name)

        # Get loader and update to use the correct vector database
        current_loader = get_loader()
        original_vstore = current_loader.vstore
        current_loader.vstore = collection_vector_db

        try:
            await current_loader.load_url(url, job_id)
        finally:
            # Restore original vector database
            current_loader.vstore = original_vstore

        # Update configuration last_updated timestamp
        if config:
            config.last_updated = datetime.datetime.now(datetime.timezone.utc)
            await store_collection_config(config)

    except Exception as e:
        logger.error(f"Ingestion failed for job {job_id}: {e}")
        job_info = await get_job_info(job_id)
        if job_info:
            job_info.status = JobStatus.FAILED
            job_info.completed_at = datetime.datetime.now(datetime.timezone.utc)
            job_info.error = str(e)
            await store_job_info(job_id, job_info)

@app.post("/v1/datasource/ingest/url", response_model=IngestResponse)
async def ingest_datasource_url(
    datasource: UrlIngest,
    background_tasks: BackgroundTasks
):
    """
    Ingest a new datasource from a URL.
    """
    logger.info(f"Ingesting datasource from URL: {datasource.url}")
    datasource.url = datasource.url.strip()

    # Create job
    job_id = str(uuid.uuid4())
    job_info = JobInfo(
        job_id=job_id,
        status=JobStatus.PENDING,
        created_at=datetime.datetime.now(datetime.timezone.utc),
        progress={"message": "Starting ingestion...", "processed": 0, "total": 0}
    )
    await store_job_info(job_id, job_info)

    # Start background task with wrapper
    background_tasks.add_task(
        run_ingestion_with_progress,
        datasource.url,
        job_id,
        datasource.collection_name
    )

    return IngestResponse(
        job_id=job_id,
        status=JobStatus.PENDING,
        message="Ingestion job started"
    )

@app.get("/v1/datasource/ingest/status/{job_id}")
async def get_ingestion_status(job_id: str):
    """
    Get the status of an ingestion job.
    """
    job_info = await get_job_info(job_id)
    if not job_info:
        raise HTTPException(status_code=404, detail="Job not found")

    logger.info(f"Returning job status for {job_id}: {job_info.status}")
    return {
        "job_id": job_id,
        "status": job_info.status,
        "progress": job_info.progress,
        "created_at": job_info.created_at.isoformat(),
        "completed_at": job_info.completed_at.isoformat() if job_info.completed_at else None,
        "error": job_info.error
    }

@app.post("/v1/datasource/ingest/file", status_code=status.HTTP_202_ACCEPTED)
async def ingest_datasource_file(
    datasource: FileIngest,
    background_tasks: BackgroundTasks
):
    """
    Ingest a new datasource from a file.
    """
    # datasource.file = datasource.file.strip()
    #TODO: implement
    # background_tasks.add_task(loader.load_file, datasource.file)

    return status.HTTP_202_ACCEPTED

@app.post("/v1/datasource/clear_all", status_code=status.HTTP_200_OK)
async def clear_all_datasource(collection_name: Optional[str] = None):
    """
    Clear all datasources from specified collection or default.
    """
    target_collection = collection_name or "rag_default"
    logger.info(f"Clearing all datasources from collection: {target_collection}")

    target_vector_db = get_vector_db(target_collection)
    await target_vector_db.adelete(expr="pk > 0") # langchain uses pk as the primary key
    return status.HTTP_200_OK

# ============================================================================
# Query Endpoint (Unchanged)
# ============================================================================

@app.post("/v1/query", response_model=QueryResult)
async def query_documents(query_request: QueryRequest):
    """
    Query for relevant documents using semantic search.
    """
    # Use the specified collection or default
    query_collection_name = query_request.collection_name or "rag_default"
    query_vector_db = get_vector_db(query_collection_name)

    docs = await query_vector_db.asimilarity_search(
        query_request.query,
        k=query_request.limit,
        score_threshold=query_request.similarity_threshold
    )

    return QueryResult(
        query=query_request.query,
        results=docs,
    )

# ============================================================================
# Health Check
# ============================================================================


@app.get("/healthz")
async def health_check():
    """
    Health check endpoint.
    """
    try:
        redis_status = "connected" if await redis_client.ping() else "disconnected"
    except Exception:
        redis_status = "error"

    return {
        "status": "healthy",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "redis_status": redis_status
    }