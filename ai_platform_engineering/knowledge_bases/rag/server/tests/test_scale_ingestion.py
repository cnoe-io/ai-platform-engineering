"""
Scale test for ingesting large numbers of HTML pages.
Tests memory efficiency and single URL processing.
"""
from asyncio import Lock
import datetime
from common.job_manager import JobManager
from common.models.rag import DataSourceInfo
from server.loader.loader import Loader
import pytest
import psutil
import time
import os
from unittest.mock import AsyncMock, MagicMock
import uuid

class MemoryMonitor:
    """Monitor memory usage during test execution."""

    def __init__(self):
        self.process = psutil.Process(os.getpid())
        self.measurements = []
        self.start_memory = None

    def start(self):
        """Start monitoring memory usage."""
        self.start_memory = self.get_memory_mb()
        self.measurements.append({
            'timestamp': time.time(),
            'memory_mb': self.start_memory,
            'phase': 'start'
        })

    def measure(self, phase: str):
        """Take a memory measurement."""
        current_memory = self.get_memory_mb()
        self.measurements.append({
            'timestamp': time.time(),
            'memory_mb': current_memory,
            'phase': phase
        })
        return current_memory

    def get_memory_mb(self) -> float:
        """Get current memory usage in MB."""
        return self.process.memory_info().rss / 1024 / 1024

    def get_peak_memory(self) -> float:
        """Get peak memory usage during monitoring."""
        return max(measurement['memory_mb'] for measurement in self.measurements)

    def get_memory_growth(self) -> float:
        """Get total memory growth from start."""
        if not self.measurements:
            return 0
        return self.measurements[-1]['memory_mb'] - self.start_memory

@pytest.fixture
def memory_monitor():
    """Memory monitoring fixture."""
    return MemoryMonitor()


@pytest.fixture
def mock_redis_scale():
    """Mock Redis client for scale testing."""
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(return_value=True)
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock(return_value=True)
    mock_redis.keys = AsyncMock(return_value=[])
    mock_redis.close = AsyncMock(return_value=None)
    mock_redis.lock = MagicMock(return_value=Lock())
    return mock_redis


@pytest.fixture
def mock_vector_db_scale():
    """Mock vector database for scale testing."""
    mock_vdb = MagicMock()
    mock_vdb.asimilarity_search = AsyncMock(return_value=[])
    mock_vdb.adelete = AsyncMock(return_value=None)
    mock_vdb.aadd_documents = AsyncMock(return_value=[])
    return mock_vdb


@pytest.fixture
def scale_loader(mock_redis_scale, mock_vector_db_scale, mock_metadata_storage):
    """Loader instance for scale testing."""
    jobmanager = JobManager(redis_client=mock_redis_scale)
    return Loader(
        vstore=mock_vector_db_scale,
        metadata_storage=mock_metadata_storage,
        datasourceinfo=DataSourceInfo(
            datasource_id="test_datasource_id",
            description="test_collection",
            source_type="url",
            path="https://example.com",
            default_chunk_size=1000,
            default_chunk_overlap=200,
            created_at=datetime.datetime.now(),
            last_updated=datetime.datetime.now(),
            total_documents=0,
            metadata={},
            job_id="test_job_id",
            total_chunks=0,
        ),
        jobmanager=jobmanager,
    )


@pytest.mark.asyncio
@pytest.mark.scale
@pytest.mark.memory
async def test_scale_ingestion_ruff_docs(scale_loader, memory_monitor):
    """
    Test ingesting the entire Ruff documentation site from its sitemap
    while monitoring memory usage.
    """
    # The base URL for the site. The loader will discover the sitemap.
    target_url = "https://docs.astral.sh/ruff/"
    job_id = str(uuid.uuid4())

    # Start memory monitoring
    memory_monitor.start()

    # Start the ingestion process
    start_time = time.time()
    memory_monitor.measure('before_ingestion')

    print(f"\nStarting ingestion for {target_url} with job_id: {job_id}")

    # The `load_url` method will find and process the sitemap
    async with scale_loader as loader:
        await loader.load_url(target_url, job_id)

    end_time = time.time()
    memory_monitor.measure('after_ingestion')

    # --- Verification ---
    processing_time = end_time - start_time
    memory_growth = memory_monitor.get_memory_growth()
    peak_memory = memory_monitor.get_peak_memory()

    # Get the number of processed documents from the mock vector DB
    processed_docs_count = scale_loader.vstore.aadd_documents.call_count

    print("\n--- Ruff Docs Ingestion Test Results ---")
    print(f"  Documents processed: {processed_docs_count}")
    print(f"  Processing time: {processing_time:.2f}s")
    print(f"  Memory growth: {memory_growth:.2f}MB")
    print(f"  Peak memory: {peak_memory:.2f}MB")
    if processed_docs_count > 0:
        print(f"  Memory per document: {memory_growth / processed_docs_count:.4f}MB")
    print("----------------------------------------")

    # Assertions
    assert scale_loader.max_concurrency > 10, "Should process documents in parallel."
    assert processed_docs_count > 50, "Should process a significant number of documents from the sitemap."
    assert memory_growth < 500, f"Memory growth was too high: {memory_growth:.2f}MB"
    assert peak_memory < 1000, f"Peak memory was too high: {peak_memory:.2f}MB"


if __name__ == "__main__":
    # Run the scale tests
    pytest.main([__file__, "-v", "-s"])
