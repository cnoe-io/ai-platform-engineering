import datetime
import json
import os
from typing import Optional, List, Dict, Any
import redis.asyncio as redis
from pydantic import BaseModel, Field
from enum import Enum
import dotenv

# Load environment variables
dotenv.load_dotenv()

# Initialize Redis client
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
redis_client = redis.from_url(redis_url, encoding="utf-8", decode_responses=True)

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
    created_at: datetime.datetime = Field(..., description="When the source was first ingested")
    last_updated: datetime.datetime = Field(..., description="When the source was last updated")
    total_documents: int = Field(0, description="Total number of documents in this source") # Adding this for convenience and future proofing
    total_chunks: int = Field(0, description="Total number of chunks in this source") # Adding this for convenience and future proofing
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class DocumentInfo(BaseModel):
    document_id: str = Field(..., description="Unique identifier for the document")
    source_id: str = Field(..., description="Source ID this document belongs to")
    url: str = Field(..., description="Document URL")
    title: str = Field("", description="Document title")
    description: str = Field("", description="Document description")
    content_length: int = Field(0, description="Original content length")
    chunk_count: int = Field(0, description="Number of chunks this document was split into")
    chunk_size: int = Field(10000, description="Chunk size used for this document")
    chunk_overlap: int = Field(2000, description="Chunk overlap used for this document")
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

# Redis helper functions for source management
async def store_source_info(source_info: SourceInfo):
    """Store source information in Redis"""
    await redis_client.setex(
        f"rag/source:{source_info.source_id}",
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
    source_data = await redis_client.get(f"rag/source:{source_id}")
    if source_data:
        data = json.loads(source_data)
        data['created_at'] = datetime.datetime.fromisoformat(data['created_at'])
        data['last_updated'] = datetime.datetime.fromisoformat(data['last_updated'])
        return SourceInfo(**data)
    return None

async def get_source_id_by_url(url: str) -> Optional[str]:
    """Get source ID by URL"""
    return await redis_client.get(f"url_to_source:{url}")

async def list_all_sources() -> List[str]:
    """List all stored source IDs"""
    keys = await redis_client.keys("rag/source:*")
    return [key.replace("rag/source:", "") for key in keys]

# Redis helper functions for document management
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

# Redis helper functions for chunk management
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

# Redis helper functions for statistics
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

# Redis helper functions for job tracking
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

# Redis cleanup functions
async def clear_source_data(source_id: str):
    """Clear all data for a specific source"""
    # Get all documents for this source
    document_ids = await redis_client.smembers(f"source_documents:{source_id}")
    
    # Get all chunk IDs for deletion
    chunk_vector_ids = []
    for doc_id in document_ids:
        chunk_ids = await redis_client.smembers(f"document_chunks:{doc_id}")
        for chunk_id in chunk_ids:
            chunk_info = await get_chunk_info(chunk_id)
            if chunk_info and chunk_info.vector_id:
                chunk_vector_ids.append(chunk_info.vector_id)
    
    # Clean up Redis data
    for doc_id in document_ids:
        chunk_ids = await redis_client.smembers(f"document_chunks:{doc_id}")
        for chunk_id in chunk_ids:
            await redis_client.delete(f"chunk:{chunk_id}")
        await redis_client.delete(f"document_chunks:{doc_id}")
        await redis_client.delete(f"document:{doc_id}")
    
    # Get source info for URL cleanup
    source_info = await get_source_info(source_id)
    source_url = source_info.url if source_info else ""
    
    await redis_client.delete(f"source_documents:{source_id}")
    await redis_client.delete(f"rag/source:{source_id}")
    if source_url:
        await redis_client.delete(f"url_to_source:{source_url}")
    
    return chunk_vector_ids

async def clear_all_data():
    """Clear all Redis data"""
    source_keys = await redis_client.keys("rag/source:*")
    document_keys = await redis_client.keys("document:*")
    chunk_keys = await redis_client.keys("chunk:*")
    mapping_keys = await redis_client.keys("url_to_source:*")
    relation_keys = await redis_client.keys("source_documents:*") + await redis_client.keys("document_chunks:*")
    
    all_keys = source_keys + document_keys + chunk_keys + mapping_keys + relation_keys
    if all_keys:
        await redis_client.delete(*all_keys)

async def get_debug_keys():
    """Get all Redis keys for debugging"""
    source_keys = await redis_client.keys("rag/source:*")
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