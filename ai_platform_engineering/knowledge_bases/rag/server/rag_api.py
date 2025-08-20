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


# Initialize embeddings
embeddings = AzureOpenAIEmbeddings(model=os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-large"))

# Initialize vector database + collections (in production, this would come from config)
vector_db: VectorStore = Milvus(
    embedding_function=embeddings,
    collection_name=os.getenv("DEFAULT_VSTORE_COLLECTION", "rag_default"),
    connection_args={"uri": os.getenv("MILVUS_URI", "http://milvus-standalone:19530")},
    index_params={"index_type": "HNSW", "metric_type": "L2"},
)

loader = Loader(vector_db, logger)

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
    limit: int = Field(10, description="Maximum number of results to return", ge=1, le=100)
    similarity_threshold: float = Field(0.7, description="Minimum similarity score", ge=0.0, le=1.0)

class QueryResult(BaseModel):
    query: str
    results: List[Document]


# ============================================================================
# Datasources Endpoints
# ============================================================================

@app.post("/v1/datasource/ingest/url", status_code=status.HTTP_202_ACCEPTED)
async def ingest_datasource_url(
    datasource: UrlIngest,
    background_tasks: BackgroundTasks
):
    """
    Ingest a new datasource from a URL.
    """
    logger.info(f"Ingesting datasource from URL: {datasource.url}")
    datasource.url = datasource.url.strip()
    background_tasks.add_task(loader.load_url, datasource.url)

    # TODO: return a id to track status
    return status.HTTP_202_ACCEPTED

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
    return {"status": "healthy", "timestamp": datetime.now()}