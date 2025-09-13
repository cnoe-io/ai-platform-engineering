import datetime
from fastapi import FastAPI, UploadFile, status, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import logging
import os
import json
from langchain_milvus import Milvus
from langchain_core.vectorstores import VectorStore
from server.loader.loader import Loader
from langchain_openai import AzureOpenAIEmbeddings
from langchain_core.documents import Document
import dotenv
import uuid
from enum import Enum
import redis.asyncio as redis
from contextlib import asynccontextmanager
import hashlib
from urllib.parse import urlparse

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
    description="A RAG (Retrieval-Augmented Generation) API for managing unified collection with source, document, and chunk tracking",
    version="2.0.0",
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

# Source and Document models
class SourceInfo(BaseModel):
    source_id: str = Field(..., description="Unique identifier for the source")
    url: str = Field(..., description="Source URL")
    domain: str = Field(..., description="Domain extracted from URL")
    chunk_size: int = Field(10000, description="Chunk size used for this source")
    chunk_overlap: int = Field(2000, description="Chunk overlap used for this source")
    created_at: datetime.datetime = Field(..., description="When the source was first ingested")
    last_updated: datetime.datetime = Field(..., description="When the source was last updated")
    total_documents: int = Field(0, description="Total number of documents in this source")
    total_chunks: int = Field(0, description="Total number of chunks in this source")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class DocumentInfo(BaseModel):
    document_id: str = Field(..., description="Unique identifier for the document")
    source_id: str = Field(..., description="Source ID this document belongs to")
    url: str = Field(..., description="Document URL")
    title: str = Field("", description="Document title")
    description: str = Field("", description="Document description")
    content_length: int = Field(0, description="Original content length")
    chunk_count: int = Field(0, description="Number of chunks this document was split into")
    created_at: datetime.datetime = Field(..., description="When the document was processed")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class ChunkInfo(BaseModel):
    chunk_id: str = Field(..., description="Unique identifier for the chunk")
    document_id: str = Field(..., description="Document ID this chunk belongs to")
    source_id: str = Field(..., description="Source ID this chunk belongs to")
    chunk_index: int = Field(..., description="Index of this chunk within the document")
    content_length: int = Field(0, description="Length of chunk content")
    vector_id: Optional[str] = Field(None, description="Vector store ID for this chunk")
    created_at: datetime.datetime = Field(..., description="When the chunk was created")

# Configuration models (updated)
class SourceConfig(BaseModel):
    url: str = Field(..., description="Source URL")
    chunk_size: int = Field(10000, description="Size of text chunks", ge=100, le=50000)
    chunk_overlap: int = Field(2000, description="Overlap between chunks", ge=0, le=5000)
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class ConfigRequest(BaseModel):
    url: str = Field(..., description="Source URL")
    chunk_size: int = Field(10000, description="Size of text chunks", ge=100, le=50000)
    chunk_overlap: int = Field(2000, description="Overlap between chunks", ge=0, le=5000)
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class ConfigResponse(BaseModel):
    success: bool
    message: str
    source_info: Optional[SourceInfo] = None

# Initialize embeddings
embeddings = AzureOpenAIEmbeddings(model=os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-large"))

# Milvus connection parameters - using single unified collection
UNIFIED_COLLECTION_NAME = "rag_unified"
milvus_connection_args = {"uri": os.getenv("MILVUS_URI", "http://milvus-standalone:19530")}
milvus_index_params = {"index_type": "HNSW", "metric_type": "L2"}

def get_vector_db() -> VectorStore:
    """Get the unified Milvus vector database"""
    return Milvus(
        embedding_function=embeddings,
        collection_name=UNIFIED_COLLECTION_NAME,
        connection_args=milvus_connection_args,
        index_params=milvus_index_params,
    )

# Initialize unified vector database (lazy initialization)
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

# ID generation utilities
def generate_source_id(url: str) -> str:
    """Generate a unique source ID based on URL domain and path"""
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    # Create a hash of the base URL to ensure uniqueness
    base_url = f"{parsed.scheme}://{domain}"
    source_hash = hashlib.md5(base_url.encode()).hexdigest()[:8]
    return f"src_{domain.replace('.', '_')}_{source_hash}"

def generate_document_id(source_id: str, url: str) -> str:
    """Generate a unique document ID based on source ID and URL"""
    url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
    return f"{source_id}_doc_{url_hash}"

def generate_chunk_id(document_id: str, chunk_index: int) -> str:
    """Generate a unique chunk ID based on document ID and chunk index"""
    return f"{document_id}_chunk_{chunk_index:04d}"

# Redis helper functions for ID management
async def store_source_info(source_info: SourceInfo):
    """Store source information in Redis"""
    await redis_client.setex(
        f"source:{source_info.source_id}",
        86400 * 30,  # 30 days expiry
        json.dumps(source_info.model_dump(), default=str)
    )
    # Also store URL to source_id mapping
    await redis_client.setex(
        f"url_to_source:{source_info.url}",
        86400 * 30,
        source_info.source_id
    )

async def get_source_info(source_id: str) -> Optional[SourceInfo]:
    """Retrieve source information from Redis"""
    source_data = await redis_client.get(f"source:{source_id}")
    if source_data:
        data = json.loads(source_data)
        data['created_at'] = datetime.datetime.fromisoformat(data['created_at'])
        data['last_updated'] = datetime.datetime.fromisoformat(data['last_updated'])
        return SourceInfo(**data)
    return None

async def get_source_id_by_url(url: str) -> Optional[str]:
    """Get source ID by URL"""
    return await redis_client.get(f"url_to_source:{url}")

async def store_document_info(document_info: DocumentInfo):
    """Store document information in Redis"""
    await redis_client.setex(
        f"document:{document_info.document_id}",
        86400 * 30,  # 30 days expiry
        json.dumps(document_info.model_dump(), default=str)
    )
    # Add to source's document list
    await redis_client.sadd(f"source_documents:{document_info.source_id}", document_info.document_id)

async def get_document_info(document_id: str) -> Optional[DocumentInfo]:
    """Retrieve document information from Redis"""
    document_data = await redis_client.get(f"document:{document_id}")
    if document_data:
        data = json.loads(document_data)
        data['created_at'] = datetime.datetime.fromisoformat(data['created_at'])
        return DocumentInfo(**data)
    return None

async def store_chunk_info(chunk_info: ChunkInfo):
    """Store chunk information in Redis"""
    await redis_client.setex(
        f"chunk:{chunk_info.chunk_id}",
        86400 * 30,  # 30 days expiry
        json.dumps(chunk_info.model_dump(), default=str)
    )
    # Add to document's chunk list
    await redis_client.sadd(f"document_chunks:{chunk_info.document_id}", chunk_info.chunk_id)

async def get_chunk_info(chunk_id: str) -> Optional[ChunkInfo]:
    """Retrieve chunk information from Redis"""
    chunk_data = await redis_client.get(f"chunk:{chunk_id}")
    if chunk_data:
        data = json.loads(chunk_data)
        data['created_at'] = datetime.datetime.fromisoformat(data['created_at'])
        return ChunkInfo(**data)
    return None

async def update_source_stats(source_id: str):
    """Update source statistics (document and chunk counts)"""
    source_info = await get_source_info(source_id)
    if source_info:
        # Count documents
        document_ids = await redis_client.smembers(f"source_documents:{source_id}")
        total_documents = len(document_ids)
        
        # Count chunks across all documents
        total_chunks = 0
        for doc_id in document_ids:
            chunk_ids = await redis_client.smembers(f"document_chunks:{doc_id}")
            total_chunks += len(chunk_ids)
        
        # Update source info
        source_info.total_documents = total_documents
        source_info.total_chunks = total_chunks
        source_info.last_updated = datetime.datetime.now(datetime.timezone.utc)
        
        await store_source_info(source_info)

async def list_all_sources() -> List[str]:
    """List all stored source IDs"""
    keys = await redis_client.keys("source:*")
    return [key.replace("source:", "") for key in keys]

# Job tracking functions (unchanged)
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
        data['created_at'] = datetime.datetime.fromisoformat(data['created_at'])
        if data.get('completed_at'):
            data['completed_at'] = datetime.datetime.fromisoformat(data['completed_at'])
        return JobInfo(**data)
    return None

# ============================================================================
# Pydantic Models (updated for unified collection)
# ============================================================================

class UrlIngest(BaseModel):
    url: str = Field(..., description="URL to ingest")
    params: Optional[Dict[str, Any]] = Field(None, description="Additional parameters")

class FileIngest(BaseModel):
    file: UploadFile = Field(..., description="File to ingest")
    params: Optional[Dict[str, Any]] = Field(None, description="Additional parameters")

class QueryRequest(BaseModel):
    query: str = Field(..., description="Query string to search for")
    limit: int = Field(3, description="Maximum number of results to return", ge=1, le=100)
    similarity_threshold: float = Field(0.7, description="Minimum similarity score", ge=0.0, le=1.0)
    source_id: Optional[str] = Field(None, description="Filter by specific source ID")

class QueryResult(BaseModel):
    query: str
    results: List[Document]

class IngestResponse(BaseModel):
    job_id: str
    status: str
    message: str
    source_id: Optional[str] = None

# ============================================================================
# Source Configuration Endpoints
# ============================================================================

@app.post("/v1/source/config", response_model=ConfigResponse)
async def set_source_config(config_request: ConfigRequest):
    """Set configuration for a source URL"""
    try:
        # Generate or get existing source ID
        source_id = await get_source_id_by_url(config_request.url)
        if not source_id:
            source_id = generate_source_id(config_request.url)

        # Check if source already exists to preserve created_at timestamp
        existing_source = await get_source_info(source_id)
        
        parsed_url = urlparse(config_request.url)
        current_time = datetime.datetime.now(datetime.timezone.utc)
        
        source_info = SourceInfo(
            source_id=source_id,
            url=config_request.url,
            domain=parsed_url.netloc,
            chunk_size=config_request.chunk_size,
            chunk_overlap=config_request.chunk_overlap,
            metadata=config_request.metadata,
            created_at=existing_source.created_at if existing_source else current_time,
            last_updated=current_time,
            total_documents=existing_source.total_documents if existing_source else 0,
            total_chunks=existing_source.total_chunks if existing_source else 0
        )
        await store_source_info(source_info)
        logger.info(f"Stored configuration for source: {source_id}")

        return ConfigResponse(
            success=True,
            message="Source configuration saved successfully",
            source_info=source_info
        )
    except Exception as e:
        logger.error(f"Failed to store source configuration: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/source/config/{source_id}", response_model=ConfigResponse)
async def get_source_config_by_id(source_id: str):
    """Get configuration for a source by ID"""
    try:
        source_info = await get_source_info(source_id)
        if not source_info:
            raise HTTPException(status_code=404, detail="Source configuration not found")

        return ConfigResponse(
            success=True,
            message="Source configuration retrieved successfully",
            source_info=source_info
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to retrieve source configuration: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/source/config", response_model=ConfigResponse)
async def get_source_config_by_url(url: str):
    """Get configuration for a source by URL"""
    try:
        logger.info(f"Looking up configuration for URL: {url}")

        source_id = await get_source_id_by_url(url)
        if not source_id:
            logger.info(f"No source found for URL: {url}")
            raise HTTPException(status_code=404, detail="Source not found for this URL")

        source_info = await get_source_info(source_id)
        if not source_info:
            logger.info(f"No configuration found for source ID: {source_id}")
            raise HTTPException(status_code=404, detail="Source configuration not found")

        logger.info(f"Found configuration for URL: {url}")
        return ConfigResponse(
            success=True,
            message="Source configuration retrieved successfully",
            source_info=source_info
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to retrieve source configuration: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/sources")
async def list_sources():
    """List all stored sources"""
    try:
        source_ids = await list_all_sources()
        sources = []
        for source_id in source_ids:
            source_info = await get_source_info(source_id)
            if source_info:
                sources.append(source_info)
        
        return {
            "success": True,
            "sources": sources,
            "count": len(sources)
        }
    except Exception as e:
        logger.error(f"Failed to list sources: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/source/{source_id}/documents")
async def get_source_documents(source_id: str):
    """Get all documents for a source"""
    try:
        source_info = await get_source_info(source_id)
        if not source_info:
            raise HTTPException(status_code=404, detail="Source not found")
        
        document_ids = await redis_client.smembers(f"source_documents:{source_id}")
        documents = []
        for doc_id in document_ids:
            doc_info = await get_document_info(doc_id)
            if doc_info:
                documents.append(doc_info)
        
        return {
            "success": True,
            "source_id": source_id,
            "documents": documents,
            "count": len(documents)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get source documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/document/{document_id}/chunks")
async def get_document_chunks(document_id: str):
    """Get all chunks for a document"""
    try:
        document_info = await get_document_info(document_id)
        if not document_info:
            raise HTTPException(status_code=404, detail="Document not found")
        
        chunk_ids = await redis_client.smembers(f"document_chunks:{document_id}")
        chunks = []
        for chunk_id in chunk_ids:
            chunk_info = await get_chunk_info(chunk_id)
            if chunk_info:
                chunks.append(chunk_info)
        
        return {
            "success": True,
            "document_id": document_id,
            "chunks": chunks,
            "count": len(chunks)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get document chunks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/debug/redis-keys")
async def debug_redis_keys():
    """Debug endpoint to see all Redis keys (for development)"""
    try:
        source_keys = await redis_client.keys("source:*")
        document_keys = await redis_client.keys("document:*")
        chunk_keys = await redis_client.keys("chunk:*")
        job_keys = await redis_client.keys("job:*")

        return {
            "source_keys": source_keys,
            "document_keys": document_keys,
            "chunk_keys": chunk_keys,
            "job_keys": job_keys,
            "total_keys": len(source_keys) + len(document_keys) + len(chunk_keys) + len(job_keys)
        }
    except Exception as e:
        logger.error(f"Failed to get Redis keys: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# Datasources Endpoints (Updated for unified collection)
# ============================================================================

async def run_ingestion_with_progress(url: str, job_id: str):
    """Wrapper function to run ingestion with proper job tracking and ID management"""
    try:
        # Generate or get existing source ID
        source_id = await get_source_id_by_url(url)
        if not source_id:
            source_id = generate_source_id(url)

        # Get or create source configuration
        source_info = await get_source_info(source_id)
        if not source_info:
            # Create default source info
            parsed_url = urlparse(url)
            current_time = datetime.datetime.now(datetime.timezone.utc)
            source_info = SourceInfo(
                source_id=source_id,
                url=url,
                domain=parsed_url.netloc,
                chunk_size=10000,  # default
                chunk_overlap=2000,  # default
                created_at=current_time,
                last_updated=current_time,
                total_documents=0,
                total_chunks=0
            )
            await store_source_info(source_info)

        logger.info(f"Using configuration for ingestion: source_id={source_id}, chunk_size={source_info.chunk_size}, chunk_overlap={source_info.chunk_overlap}")
        
        # Get loader and set chunking configuration
        current_loader = get_loader()
        current_loader.set_chunking_config(source_info.chunk_size, source_info.chunk_overlap)
        
        # Set the source_id in loader for ID tracking
        current_loader.current_source_id = source_id

        await current_loader.load_url(url, job_id)

        # Update source statistics after ingestion
        await update_source_stats(source_id)

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
    Ingest a new datasource from a URL into the unified collection.
    """
    logger.info(f"Ingesting datasource from URL: {datasource.url}")
    datasource.url = datasource.url.strip()

    # Generate source ID for response
    source_id = await get_source_id_by_url(datasource.url)
    if not source_id:
        source_id = generate_source_id(datasource.url)

    # Create job
    job_id = str(uuid.uuid4())
    job_info = JobInfo(
        job_id=job_id,
        status=JobStatus.PENDING,
        created_at=datetime.datetime.now(datetime.timezone.utc),
        progress={"message": "Starting ingestion...", "processed": 0, "total": 0}
    )
    await store_job_info(job_id, job_info)

    # Start background task
    background_tasks.add_task(
        run_ingestion_with_progress,
        datasource.url,
        job_id
    )

    return IngestResponse(
        job_id=job_id,
        status=JobStatus.PENDING,
        message="Ingestion job started",
        source_id=source_id
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
async def clear_all_datasource(source_id: Optional[str] = None):
    """
    Clear all datasources from unified collection or specific source.
    """
    if source_id:
        logger.info(f"Clearing datasources for source: {source_id}")
        # Get all documents for this source
        document_ids = await redis_client.smembers(f"source_documents:{source_id}")
        
        # Get all chunk IDs for deletion from vector store
        chunk_vector_ids = []
        for doc_id in document_ids:
            chunk_ids = await redis_client.smembers(f"document_chunks:{doc_id}")
            for chunk_id in chunk_ids:
                chunk_info = await get_chunk_info(chunk_id)
                if chunk_info and chunk_info.vector_id:
                    chunk_vector_ids.append(chunk_info.vector_id)
        
        # Delete from vector store
        if chunk_vector_ids:
            vector_db = get_vector_db()
            # Note: This might need adjustment based on how Milvus handles deletion by IDs
            await vector_db.adelete(ids=chunk_vector_ids)
        
        # Clean up Redis data
        for doc_id in document_ids:
            chunk_ids = await redis_client.smembers(f"document_chunks:{doc_id}")
            for chunk_id in chunk_ids:
                await redis_client.delete(f"chunk:{chunk_id}")
            await redis_client.delete(f"document_chunks:{doc_id}")
            await redis_client.delete(f"document:{doc_id}")
        
        await redis_client.delete(f"source_documents:{source_id}")
        await redis_client.delete(f"source:{source_id}")
        await redis_client.delete(f"url_to_source:{(await get_source_info(source_id)).url if await get_source_info(source_id) else ''}")
        
    else:
        logger.info("Clearing all datasources from unified collection")
        vector_db = get_vector_db()
        await vector_db.adelete(expr="pk > 0")  # langchain uses pk as the primary key
        
        # Clear all Redis data
        source_keys = await redis_client.keys("source:*")
        document_keys = await redis_client.keys("document:*")
        chunk_keys = await redis_client.keys("chunk:*")
        mapping_keys = await redis_client.keys("url_to_source:*")
        relation_keys = await redis_client.keys("source_documents:*") + await redis_client.keys("document_chunks:*")
        
        all_keys = source_keys + document_keys + chunk_keys + mapping_keys + relation_keys
        if all_keys:
            await redis_client.delete(*all_keys)
    
    return status.HTTP_200_OK

# ============================================================================
# Query Endpoint (Updated for unified collection)
# ============================================================================

@app.post("/v1/query", response_model=QueryResult)
async def query_documents(query_request: QueryRequest):
    """
    Query for relevant documents using semantic search in the unified collection.
    """
    # Use the unified collection
    query_vector_db = get_vector_db()
    
    # Build filter expression for source filtering if specified
    filter_expr = None
    if query_request.source_id:
        # Filter by source_id in metadata
        filter_expr = f"source_id == '{query_request.source_id}'"

    # Perform similarity search with optional filtering
    if filter_expr:
        docs = await query_vector_db.asimilarity_search(
            query_request.query,
            k=query_request.limit,
            score_threshold=query_request.similarity_threshold,
            expr=filter_expr
        )
    else:
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