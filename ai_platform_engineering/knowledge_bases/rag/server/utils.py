import datetime
import hashlib
import logging
import os
import uuid
from typing import Optional, Dict, Any
from urllib.parse import urlparse
import dotenv

# Load environment variables
dotenv.load_dotenv()

from langchain_milvus import Milvus
from langchain_core.vectorstores import VectorStore
from langchain_openai import AzureOpenAIEmbeddings

from .redis_client import (
    redis_client, SourceInfo, get_source_info, get_source_id_by_url, 
    store_source_info, JobInfo, JobStatus, store_job_info, get_job_info,
    update_source_stats
)

# Initialize logger
logger = logging.getLogger("uvicorn")
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))

# Initialize embeddings
embeddings = AzureOpenAIEmbeddings(model=os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-large"))

# Milvus connection parameters - using single unified collection
DEFAULT_COLLECTION_NAME = "rag_default"
milvus_connection_args = {"uri": os.getenv("MILVUS_URI", "http://milvus-standalone:19530")}
milvus_index_params = {"index_type": "HNSW", "metric_type": "L2"}

# Global variables for lazy initialization
vector_db: VectorStore = None
loader = None

def get_vector_db() -> VectorStore:
    """Get the unified Milvus vector database"""
    return Milvus(
        embedding_function=embeddings,
        collection_name=DEFAULT_COLLECTION_NAME,
        connection_args=milvus_connection_args,
        index_params=milvus_index_params,
    )

def get_loader():
    """Get or create the loader instance"""
    global loader, vector_db
    if loader is None:
        from server.loader.loader import Loader
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

# Ingestion utilities
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
                created_at=current_time,
                last_updated=current_time,
                total_documents=0,
                total_chunks=0
            )
            await store_source_info(source_info)

        logger.info(f"Using configuration for ingestion: source_id={source_id}")
        
        # Get loader
        current_loader = get_loader()
        
        # Set the source_id and source_info in loader for ID tracking and chunk config
        current_loader.current_source_id = source_id
        current_loader.current_source_info = source_info

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

def create_job(url: str) -> tuple[str, JobInfo]:
    """Create a new ingestion job"""
    job_id = str(uuid.uuid4())
    job_info = JobInfo(
        job_id=job_id,
        status=JobStatus.PENDING,
        created_at=datetime.datetime.now(datetime.timezone.utc),
        progress={"message": "Starting ingestion...", "processed": 0, "total": 0}
    )
    return job_id, job_info

async def get_or_create_source_info(url: str, metadata: Optional[Dict[str, Any]] = None) -> SourceInfo:
    """Get existing source info or create a new one"""
    source_id = await get_source_id_by_url(url)
    if not source_id:
        source_id = generate_source_id(url)

    # Check if source already exists to preserve created_at timestamp
    existing_source = await get_source_info(source_id)
    
    parsed_url = urlparse(url)
    current_time = datetime.datetime.now(datetime.timezone.utc)
    
    source_info = SourceInfo(
        source_id=source_id,
        url=url,
        domain=parsed_url.netloc,
        metadata=metadata,
        created_at=existing_source.created_at if existing_source else current_time,
        last_updated=current_time,
        total_documents=existing_source.total_documents if existing_source else 0,
        total_chunks=existing_source.total_chunks if existing_source else 0
    )
    
    return source_info

# Vector database utilities
async def clear_vector_data(chunk_vector_ids: list = None, clear_all: bool = False):
    """Clear vector data from the database"""
    vector_db_instance = get_vector_db()
    
    if clear_all:
        await vector_db_instance.adelete(expr="pk > 0")  # langchain uses pk as the primary key
    elif chunk_vector_ids:
        await vector_db_instance.adelete(ids=chunk_vector_ids)

async def query_vector_db(query: str, limit: int = 3, similarity_threshold: float = 0.7, source_id: Optional[str] = None):
    """Query the vector database with optional source filtering"""
    query_vector_db = get_vector_db()
    
    # Build filter expression for source filtering if specified
    filter_expr = None
    if source_id:
        # Filter by source_id in metadata
        filter_expr = f"source_id == '{source_id}'"

    # Perform similarity search with optional filtering
    if filter_expr:
        docs = await query_vector_db.asimilarity_search(
            query,
            k=limit,
            score_threshold=similarity_threshold,
            expr=filter_expr
        )
    else:
        docs = await query_vector_db.asimilarity_search(
            query,
            k=limit,
            score_threshold=similarity_threshold
        )

    return docs 