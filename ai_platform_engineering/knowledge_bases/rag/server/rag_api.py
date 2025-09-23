import datetime
from fastapi import FastAPI, status, BackgroundTasks, HTTPException
from contextlib import asynccontextmanager
from typing import Optional
import logging
import os

from .redis_client import (
    redis_client, get_source_info, get_source_id_by_url, list_all_sources,
    get_document_info, get_chunk_info, store_source_info, get_job_info,
    clear_source_data, clear_all_data, get_debug_keys, JobStatus
)
from .utils import (
    get_or_create_source_info, generate_source_id, run_ingestion_with_progress,
    create_job, store_job_info, clear_vector_data, query_vector_db, get_loader
)
from .models import (
    ConfigRequest, ConfigResponse, UrlIngest, FileIngest, IngestResponse,
    QueryRequest, QueryResult
)

# Initialize logger
logger = logging.getLogger("uvicorn")
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))

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
    loader = get_loader()
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

# ============================================================================
# Source Configuration Endpoints
# ============================================================================

@app.post("/v1/source/config", response_model=ConfigResponse)
async def set_source_config(config_request: ConfigRequest):
    """Set configuration for a source URL"""
    try:
        # Store chunk_size and chunk_overlap in metadata
        metadata = config_request.metadata or {}
        metadata.update({
            "default_chunk_size": config_request.chunk_size,
            "default_chunk_overlap": config_request.chunk_overlap
        })
        
        source_info = await get_or_create_source_info(
            url=config_request.url,
            metadata=metadata
        )
        await store_source_info(source_info)
        logger.info(f"Stored configuration for source: {source_info.source_id}")

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
        return await get_debug_keys()
    except Exception as e:
        logger.error(f"Failed to get Redis keys: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# Datasources Endpoints
# ============================================================================

@app.post("/v1/datasource/ingest/url", response_model=IngestResponse)
async def ingest_datasource_url(
    datasource: UrlIngest,
    background_tasks: BackgroundTasks
):
    """Ingest a new datasource from a URL into the unified collection."""
    logger.info(f"Ingesting datasource from URL: {datasource.url}")
    datasource.url = datasource.url.strip()

    # Generate source ID for response
    source_id = await get_source_id_by_url(datasource.url)
    if not source_id:
        source_id = generate_source_id(datasource.url)

    # Create job
    job_id, job_info = create_job(datasource.url)
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
    """Get the status of an ingestion job."""
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
    """Ingest a new datasource from a file."""
    # TODO: implement file ingestion
    return status.HTTP_202_ACCEPTED

@app.post("/v1/datasource/clear_all", status_code=status.HTTP_200_OK)
async def clear_all_datasource(source_id: Optional[str] = None):
    """Clear all datasources from unified collection or specific source."""
    if source_id:
        logger.info(f"Clearing datasources for source: {source_id}")
        chunk_vector_ids = await clear_source_data(source_id)
        
        # Delete from vector store
        if chunk_vector_ids:
            await clear_vector_data(chunk_vector_ids=chunk_vector_ids)
    else:
        logger.info("Clearing all datasources from unified collection")
        await clear_vector_data(clear_all=True)
        await clear_all_data()
    
    return status.HTTP_200_OK

# ============================================================================
# Query Endpoint
# ============================================================================

@app.post("/v1/query", response_model=QueryResult)
async def query_documents(query_request: QueryRequest):
    """Query for relevant documents using semantic search in the unified collection."""
    docs = await query_vector_db(
        query=query_request.query,
        limit=query_request.limit,
        similarity_threshold=query_request.similarity_threshold,
        source_id=query_request.source_id
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
    """Health check endpoint."""
    try:
        redis_status = "connected" if await redis_client.ping() else "disconnected"
    except Exception:
        redis_status = "error"

    return {
        "status": "healthy",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "redis_status": redis_status
    }