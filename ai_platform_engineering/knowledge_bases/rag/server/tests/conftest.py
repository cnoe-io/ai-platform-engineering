"""
Test configuration and fixtures for RAG server tests.
"""
import os
from common.graph_db.neo4j.graph_db import GraphDB
from common.job_manager import JobManager
from server.query_service import VectorDBQueryService
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
import redis.asyncio as redis
from langchain_core.vectorstores import VectorStore
from langchain_core.documents import Document
import asyncio
from asyncio import Lock
from contextlib import ExitStack



# Mock Azure OpenAI environment variables before importing the app
os.environ.setdefault("AZURE_OPENAI_API_KEY", "mock-test-key")
os.environ.setdefault("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com/")
os.environ.setdefault("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
os.environ.setdefault("EMBEDDINGS_MODEL", "text-embedding-3-large")
os.environ.setdefault("SKIP_INIT_TESTS", "true")  # Skip connection tests in testing
os.environ.setdefault("ENABLE_MCP", "false")  # Disable MCP

from server.loader.loader import Loader
from server.metadata_storage import MetadataStorage


@pytest.fixture
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_redis():
    """Mock Redis client for testing."""
    mock_redis = AsyncMock(spec=redis.Redis)
    mock_redis.ping = AsyncMock(return_value=True)
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock(return_value=True)
    mock_redis.keys = AsyncMock(return_value=[])
    mock_redis.close = AsyncMock(return_value=None)
    mock_redis.lock = MagicMock(return_value=Lock())
    return mock_redis


@pytest.fixture
def mock_vector_db():
    """Mock vector database for testing."""
    mock_vdb = MagicMock(spec=VectorStore)
    mock_vdb.asimilarity_search_with_score = AsyncMock(return_value=[])
    mock_vdb.adelete = AsyncMock(return_value=None)
    return mock_vdb


@pytest.fixture
def mock_graph_db():
    """Mock graph database for testing."""
    mock_db = MagicMock(spec=GraphDB)
    mock_db.update_entity = AsyncMock(return_value=None)
    mock_db.update_relation = AsyncMock(return_value=None)
    return mock_db

@pytest.fixture
def mock_job_manager(mock_redis):
    """Mock job manager for testing."""
    mock_job_manager = MagicMock(spec=JobManager, redis_client=mock_redis)
    return mock_job_manager

@pytest.fixture
def mock_metadata_storage(mock_redis):
    """Mock metadata storage for testing."""
    mock_metadata_storage = MagicMock(spec=MetadataStorage, redis_client=mock_redis)
    return mock_metadata_storage

@pytest.fixture
def mock_query_service(mock_vector_db):
    """Mock query service for testing."""
    return VectorDBQueryService(vector_db=mock_vector_db)

@pytest.fixture
def mock_loader(mock_vector_db, mock_metadata_storage, mock_job_manager):
    """Mock loader for testing."""
    # Fully mock the session and its response lifecycle
    mock_session = AsyncMock()
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.text.return_value = "Sitemap: https://example.com/sitemap.xml"
    mock_session.get.return_value.__aenter__.return_value = mock_response

    with patch('server.loader.loader.Loader') as mock_loader_class:
        mock_loader_instance = MagicMock(spec=Loader)
        mock_loader_instance.vstore = mock_vector_db
        mock_loader_instance.metadata_storage = mock_metadata_storage
        mock_loader_instance.jobmanager = mock_job_manager
        mock_loader_instance.session = mock_session
        mock_loader_instance.load_url = AsyncMock()
        mock_loader_instance.close = AsyncMock()
        mock_loader_instance.set_chunking_config = MagicMock()

        # When Loader is instantiated, return our mock instance
        mock_loader_class.return_value = mock_loader_instance
        yield mock_loader_instance


@pytest.fixture
def test_client(mock_metadata_storage, mock_job_manager, mock_vector_db, mock_graph_db, mock_query_service):
    """Test client for FastAPI app."""
    with ExitStack() as stack:
        # Mock external dependencies to prevent actual connections during lifespan
        stack.enter_context(patch('langchain_milvus.Milvus', return_value=mock_vector_db))
        stack.enter_context(patch('server.restapi.Neo4jDB', return_value=mock_graph_db))
        stack.enter_context(patch('server.restapi.JobManager', return_value=mock_job_manager))
        stack.enter_context(patch('server.restapi.MetadataStorage', return_value=mock_metadata_storage))
        stack.enter_context(patch('server.restapi.VectorDBQueryService', return_value=mock_query_service))
        stack.enter_context(patch('redis.from_url', return_value=mock_metadata_storage.redis_client))
        stack.enter_context(patch('langchain_openai.AzureOpenAIEmbeddings', return_value=MagicMock()))
        
        # Mock MCP components
        stack.enter_context(patch('server.restapi.FastMCP', return_value=MagicMock()))
        
        from server.restapi import app
        with TestClient(app) as client:
            yield client

@pytest.fixture
def sample_document():
    """Sample document for testing."""
    return Document(
        page_content="This is a test document content.",
        metadata={"source": "https://example.com", "title": "Test Document"}
    )


@pytest.fixture
def sample_urls():
    """Sample URLs for testing."""
    return [
        "https://example.com/page1",
        "https://example.com/page2",
        "https://example.com/page3"
    ]


@pytest.fixture
def sample_config():
    """Sample collection configuration for testing."""
    return {
        "collection_name": "test_collection",
        "url": "https://example.com",
        "chunk_size": 1000,
        "chunk_overlap": 200,
        "metadata": {"test": "data"}
    }