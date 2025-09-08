"""
Test configuration and fixtures for RAG server tests.
"""
import os
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
import redis.asyncio as redis
from langchain_core.vectorstores import VectorStore
from langchain_core.documents import Document

# Mock Azure OpenAI environment variables before importing the app
os.environ.setdefault("AZURE_OPENAI_API_KEY", "mock-test-key")
os.environ.setdefault("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com/")
os.environ.setdefault("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
os.environ.setdefault("EMBEDDINGS_MODEL", "text-embedding-3-large")

from server.rag_api import app
from server.loader.loader import Loader


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
    return mock_redis


@pytest.fixture
def mock_vector_db():
    """Mock vector database for testing."""
    mock_vdb = MagicMock(spec=VectorStore)
    mock_vdb.asimilarity_search = AsyncMock(return_value=[])
    mock_vdb.adelete = AsyncMock(return_value=None)
    return mock_vdb


@pytest.fixture
def mock_loader(mock_vector_db, mock_redis):
    """Mock loader for testing."""
    with patch('server.rag_api.loader') as mock_loader_class:
        mock_loader = MagicMock(spec=Loader)
        mock_loader.vstore = mock_vector_db
        mock_loader.load_url = AsyncMock()
        mock_loader.close = AsyncMock()
        mock_loader.set_chunking_config = MagicMock()
        mock_loader_class.return_value = mock_loader
        yield mock_loader


@pytest.fixture
def test_client(mock_redis, mock_loader):
    """Test client for FastAPI app."""
    with patch('server.rag_api.redis_client', mock_redis), \
         patch('server.rag_api.loader', mock_loader):
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
