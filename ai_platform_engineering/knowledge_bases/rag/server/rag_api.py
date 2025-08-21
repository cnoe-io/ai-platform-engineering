import datetime
from fastapi import FastAPI, UploadFile, status, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import logging
import os
from langchain_milvus import Milvus
from langchain_core.vectorstores import VectorStore
from loader.loader import Loader
from langchain_openai import AzureOpenAIEmbeddings
from langchain_core.documents import Document
import dotenv
import uuid
from enum import Enum

dotenv.load_dotenv()

# Initialize logger
logger = logging.getLogger("uvicorn")
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))

# Initialize FastAPI app
app = FastAPI(
    title="RAG API",
    description="A RAG (Retrieval-Augmented Generation) API for managing collections, sources, documents, chunks, and queries",
    version="1.0.0",
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

# In-memory job store (in production, use Redis or a database)
jobs_store: Dict[str, JobInfo] = {}

# Initialize embeddings
embeddings = AzureOpenAIEmbeddings(model=os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-large"))

# Initialize vector database + collections (in production, this would come from config)
vector_db: VectorStore = Milvus(
    embedding_function=embeddings,
    collection_name=os.getenv("DEFAULT_VSTORE_COLLECTION", "rag_default"),
    connection_args={"uri": os.getenv("MILVUS_URI", "http://milvus-standalone:19530")},
    index_params={"index_type": "HNSW", "metric_type": "L2"},
)

# Initialize loader without jobs_store initially (we'll set it later)
loader = Loader(vector_db, logger)

# Set the jobs_store reference on the loader
loader.set_jobs_store(jobs_store)

@app.on_event("shutdown")
async def _close_loader_session():
    await loader.close()

# ============================================================================
# Pydantic Models
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

class QueryResult(BaseModel):
    query: str
    results: List[Document]

class IngestResponse(BaseModel):
    job_id: str
    status: str
    message: str

# ============================================================================
# Datasources Endpoints
# ============================================================================

async def run_ingestion_with_progress(url: str, job_id: str):
    """Wrapper function to run ingestion with proper job tracking"""
    try:
        # Ensure loader has jobs_store reference
        if not hasattr(loader, 'jobs_store') or loader.jobs_store is None:
            loader.set_jobs_store(jobs_store)
        
        await loader.load_url(url, job_id)
    except Exception as e:
        logger.error(f"Ingestion failed for job {job_id}: {e}")
        if job_id in jobs_store:
            job_info = jobs_store[job_id]
            job_info.status = JobStatus.FAILED
            job_info.completed_at = datetime.datetime.now()
            job_info.error = str(e)

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
        created_at=datetime.datetime.now(),
        progress={"message": "Starting ingestion...", "processed": 0, "total": 0}
    )
    jobs_store[job_id] = job_info
    
    # Start background task with wrapper
    background_tasks.add_task(run_ingestion_with_progress, datasource.url, job_id)
    
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
    if job_id not in jobs_store:
        return {"error": "Job not found"}
    
    job_info = jobs_store[job_id]
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
async def clear_all_datasource():
    """
    Clear all datasources.
    """
    logger.info("Clearing all datasources")
    await vector_db.adelete(expr="pk > 0") # lanchain uses pk as the primary key
    return status.HTTP_200_OK

# ============================================================================
# Query Endpoint
# ============================================================================

@app.post("/v1/query", response_model=QueryResult)
async def query_documents(query_request: QueryRequest):
    """
    Query for relevant documents using semantic search.
    """
    docs = await vector_db.asimilarity_search(query_request.query, k=query_request.limit, score_threshold=query_request.similarity_threshold)

    # Placeholder response
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
    return {"status": "healthy", "timestamp": datetime.datetime.now().isoformat()}