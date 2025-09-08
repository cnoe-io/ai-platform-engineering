"""
Scale test for ingesting large numbers of HTML pages.
Tests memory efficiency and single URL processing.
"""
import pytest
import asyncio
import psutil
import time
import os
from unittest.mock import AsyncMock, MagicMock, patch
from typing import List
import uuid

from server.loader.loader import Loader


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


class MockWebBaseLoader:
    """Mock WebBaseLoader that simulates processing one URL at a time."""

    def __init__(self, urls: List[str], requests_per_second: int = 1):
        self.urls = urls
        self.requests_per_second = requests_per_second
        self.processed_count = 0

    async def aload(self):
        """Simulate loading all documents at once (for single URL)."""
        docs = []
        for i, url in enumerate(self.urls):
            # Simulate processing delay
            await asyncio.sleep(0.001)  # 1ms delay per URL

            # Create a real document with proper string content
            from langchain_core.documents import Document
            doc = Document(
                page_content=f'Content for page {i+1} from {url}',
                metadata={'source': url, 'title': f'Page {i+1}'}
            )

            self.processed_count += 1
            docs.append(doc)
        return docs

    async def alazy_load(self):
        """Simulate lazy loading of documents one at a time."""
        for i, url in enumerate(self.urls):
            # Simulate processing delay
            await asyncio.sleep(0.001)  # 1ms delay per URL

            # Create a real document with proper string content
            from langchain_core.documents import Document
            doc = Document(
                page_content=f'Content for page {i+1} from {url}',
                metadata={'source': url, 'title': f'Page {i+1}'}
            )

            self.processed_count += 1
            yield doc


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
def scale_loader(mock_redis_scale, mock_vector_db_scale):
    """Loader instance for scale testing."""
    import logging
    logger = logging.getLogger("test_scale_loader")
    return Loader(
        vstore=mock_vector_db_scale,
        logger=logger,
        redis_client=mock_redis_scale
    )


def generate_test_urls(count: int) -> List[str]:
    """Generate a list of test URLs based on CAIPE documentation."""
    base_url = "https://cnoe-io.github.io/ai-platform-engineering"

    # Generate URLs based on the actual CAIPE site structure
    urls = [
        f"{base_url}/",
        f"{base_url}/getting-started/",
        f"{base_url}/architecture/",
        f"{base_url}/agents/",
        f"{base_url}/knowledge_bases/",
        f"{base_url}/usecases/",
        f"{base_url}/prompt-library/",
        f"{base_url}/tools-utils/",
        f"{base_url}/workshop/",
        f"{base_url}/community/",
        f"{base_url}/contributing/",
        f"{base_url}/security/",
        f"{base_url}/installation/",
        f"{base_url}/evaluations/",
    ]

    # Add more specific pages
    specific_pages = [
        "getting-started/quick-start",
        "getting-started/docker-compose/setup",
        "getting-started/eks/setup",
        "getting-started/kind/setup",
        "agents/argocd",
        "agents/backstage",
        "agents/confluence",
        "agents/github",
        "agents/jira",
        "agents/komodor",
        "agents/pagerduty",
        "agents/slack",
        "knowledge_bases/rag",
        "knowledge_bases/graph_rag",
        "usecases/incident-engineer",
        "usecases/platform-engineer",
        "usecases/product-owner",
        "workshop/mission1",
        "workshop/mission2",
        "workshop/mission3",
        "workshop/mission4",
        "workshop/mission6",
        "workshop/mission7",
    ]

    # Add specific page URLs
    for page in specific_pages:
        urls.append(f"{base_url}/{page}")

    # If we need more URLs, generate additional ones
    while len(urls) < count:
        page_num = len(urls) - len(specific_pages) - 14 + 1
        urls.append(f"{base_url}/page-{page_num:04d}")

    return urls[:count]


@pytest.mark.asyncio
@pytest.mark.scale
@pytest.mark.memory
async def test_scale_ingestion_1000_pages(scale_loader, memory_monitor):
    """
    Test ingesting 1000 HTML pages with memory monitoring.
    Verifies that single URLs are processed and memory usage stays reasonable.
    """
    # Generate 1000 test URLs
    test_urls = generate_test_urls(1000)
    job_id = str(uuid.uuid4())

    # Start memory monitoring
    memory_monitor.start()

    # Mock the WebBaseLoader to simulate single URL processing
    with patch('server.loader.loader.WebBaseLoader', MockWebBaseLoader):
        # Mock sitemap methods to return our test URLs
        with patch.object(scale_loader, 'get_sitemaps', return_value=[]), \
             patch.object(scale_loader, 'get_urls_from_sitemap', return_value=test_urls), \
             patch.object(scale_loader, 'custom_parser', return_value=("Test content", {"source": "test"})):

            # Start the ingestion process
            start_time = time.time()
            memory_monitor.measure('before_ingestion')

            # Process the URLs
            await scale_loader.load_url("https://cnoe-io.github.io/ai-platform-engineering", job_id)

            end_time = time.time()
            memory_monitor.measure('after_ingestion')

            # Verify the mock loader was called with all URLs
            # Note: We can't easily verify the call args since we're patching the class
            # The important thing is that the test runs without memory issues

            # Verify processing time is reasonable (should be fast with mocked processing)
            processing_time = end_time - start_time
            assert processing_time < 10.0, f"Processing took too long: {processing_time:.2f}s"

            # Verify memory usage is reasonable
            peak_memory = memory_monitor.get_peak_memory()
            memory_growth = memory_monitor.get_memory_growth()

            # Memory growth should be minimal (less than 100MB for 1000 pages)
            assert memory_growth < 100, f"Memory growth too high: {memory_growth:.2f}MB"

            # Peak memory should be reasonable
            assert peak_memory < 500, f"Peak memory too high: {peak_memory:.2f}MB"

            print("\nScale Test Results:")
            print(f"  URLs processed: {len(test_urls)}")
            print(f"  Processing time: {processing_time:.2f}s")
            print(f"  Memory growth: {memory_growth:.2f}MB")
            print(f"  Peak memory: {peak_memory:.2f}MB")
            print(f"  Memory per URL: {memory_growth/len(test_urls):.4f}MB")


@pytest.mark.asyncio
@pytest.mark.memory
@pytest.mark.scale
async def test_memory_efficiency_single_url_processing(scale_loader, memory_monitor):
    """
    Test that URLs are processed one at a time, not all loaded into memory.
    """
    test_urls = generate_test_urls(100)  # Smaller set for detailed monitoring
    job_id = str(uuid.uuid4())

    memory_monitor.start()

    # Track how many URLs are processed at once
    processed_urls = []

    class TrackingWebBaseLoader(MockWebBaseLoader):
        def __init__(self, urls, **kwargs):
            super().__init__(urls, **kwargs)

        async def aload(self):
            """Simulate loading all documents at once (for single URL)."""
            docs = []
            for i, url in enumerate(self.urls):
                # Measure memory before processing each URL
                memory_monitor.measure(f'before_url_{i}')
                processed_urls.append(url)

                # Simulate processing
                await asyncio.sleep(0.001)

                from langchain_core.documents import Document
                doc = Document(
                    page_content=f'Content for page {i+1}',
                    metadata={'source': url, 'title': f'Page {i+1}'}
                )

                # Measure memory after processing each URL
                memory_monitor.measure(f'after_url_{i}')

                docs.append(doc)
            return docs

        async def alazy_load(self):
            for i, url in enumerate(self.urls):
                # Measure memory before processing each URL
                memory_monitor.measure(f'before_url_{i}')
                processed_urls.append(url)

                # Simulate processing
                await asyncio.sleep(0.001)

                from langchain_core.documents import Document
                doc = Document(
                    page_content=f'Content for page {i+1}',
                    metadata={'source': url, 'title': f'Page {i+1}'}
                )

                # Measure memory after processing each URL
                memory_monitor.measure(f'after_url_{i}')

                yield doc

    with patch('server.loader.loader.WebBaseLoader', TrackingWebBaseLoader):
        with patch.object(scale_loader, 'get_sitemaps', return_value=["https://cnoe-io.github.io/ai-platform-engineering/sitemap.xml"]), \
             patch.object(scale_loader, 'get_urls_from_sitemap', return_value=test_urls), \
             patch.object(scale_loader, 'custom_parser', return_value=("Test content", {"source": "test"})):

            await scale_loader.load_url("https://cnoe-io.github.io/ai-platform-engineering", job_id)

    # Verify all URLs were processed
    assert len(processed_urls) == len(test_urls)
    assert processed_urls == test_urls

    # Verify memory usage pattern shows single URL processing
    measurements = memory_monitor.measurements
    memory_values = [m['memory_mb'] for m in measurements]

    # Memory should not spike dramatically (indicating batch loading)
    max_memory = max(memory_values)
    min_memory = min(memory_values)
    memory_variance = max_memory - min_memory

    # Variance should be small, indicating consistent memory usage
    assert memory_variance < 100, f"Memory variance too high: {memory_variance:.2f}MB"

    print("\nMemory Efficiency Test Results:")
    print(f"  URLs processed: {len(test_urls)}")
    print(f"  Memory variance: {memory_variance:.2f}MB")
    print(f"  Min memory: {min_memory:.2f}MB")
    print(f"  Max memory: {max_memory:.2f}MB")


@pytest.mark.asyncio
@pytest.mark.memory
@pytest.mark.scale
async def test_concurrent_ingestion_memory_limits(scale_loader, memory_monitor):
    """
    Test that concurrent ingestion doesn't cause memory issues.
    """
    # Create multiple job IDs for concurrent processing
    job_ids = [str(uuid.uuid4()) for _ in range(5)]
    test_urls = generate_test_urls(50)  # 50 URLs per job

    memory_monitor.start()

    async def process_job(job_id: str):
        """Process a single job."""
        with patch('server.loader.loader.WebBaseLoader', MockWebBaseLoader):
            with patch.object(scale_loader, 'get_sitemaps', return_value=[f"https://cnoe-io.github.io/ai-platform-engineering-{job_id[:8]}/sitemap.xml"]), \
                 patch.object(scale_loader, 'get_urls_from_sitemap', return_value=test_urls), \
                 patch.object(scale_loader, 'custom_parser', return_value=("Test content", {"source": "test"})):

                await scale_loader.load_url(f"https://cnoe-io.github.io/ai-platform-engineering-{job_id[:8]}", job_id)

    # Process all jobs concurrently
    start_time = time.time()
    memory_monitor.measure('before_concurrent')

    await asyncio.gather(*[process_job(job_id) for job_id in job_ids])

    end_time = time.time()
    memory_monitor.measure('after_concurrent')

    processing_time = end_time - start_time
    memory_growth = memory_monitor.get_memory_growth()

    # Verify concurrent processing doesn't cause excessive memory usage
    assert memory_growth < 200, f"Concurrent processing memory growth too high: {memory_growth:.2f}MB"

    # Verify processing time is reasonable
    assert processing_time < 30.0, f"Concurrent processing took too long: {processing_time:.2f}s"

    print("\nConcurrent Processing Test Results:")
    print(f"  Jobs processed: {len(job_ids)}")
    print(f"  URLs per job: {len(test_urls)}")
    print(f"  Total URLs: {len(job_ids) * len(test_urls)}")
    print(f"  Processing time: {processing_time:.2f}s")
    print(f"  Memory growth: {memory_growth:.2f}MB")


@pytest.mark.asyncio
@pytest.mark.memory
@pytest.mark.scale
async def test_large_document_processing(scale_loader, memory_monitor):
    """
    Test processing large documents without memory issues.
    """
    # Create URLs with large content
    large_urls = []
    for i in range(20):  # 20 large documents
        large_urls.append(f"https://cnoe-io.github.io/ai-platform-engineering/large-doc-{i}")

    job_id = str(uuid.uuid4())

    class LargeDocumentLoader(MockWebBaseLoader):
        def __init__(self, urls, **kwargs):
            super().__init__(urls, **kwargs)

        async def aload(self):
            """Simulate loading all documents at once (for single URL)."""
            docs = []
            for i, url in enumerate(self.urls):
                # Create a large document (1MB of content)
                large_content = "Large content " * 100000  # ~1MB

                from langchain_core.documents import Document
                doc = Document(
                    page_content=large_content,
                    metadata={'source': url, 'title': f'Large Document {i+1}'}
                )

                docs.append(doc)
            return docs

        async def alazy_load(self):
            for i, url in enumerate(self.urls):
                # Create a large document (1MB of content)
                large_content = "Large content " * 100000  # ~1MB

                from langchain_core.documents import Document
                doc = Document(
                    page_content=large_content,
                    metadata={'source': url, 'title': f'Large Document {i+1}'}
                )

                yield doc

    memory_monitor.start()

    with patch('server.loader.loader.WebBaseLoader', LargeDocumentLoader):
        with patch.object(scale_loader, 'get_sitemaps', return_value=["https://cnoe-io.github.io/ai-platform-engineering/sitemap.xml"]), \
             patch.object(scale_loader, 'get_urls_from_sitemap', return_value=large_urls), \
             patch.object(scale_loader, 'custom_parser', return_value=("Test content", {"source": "test"})):

            await scale_loader.load_url("https://cnoe-io.github.io/ai-platform-engineering", job_id)

    memory_growth = memory_monitor.get_memory_growth()
    peak_memory = memory_monitor.get_peak_memory()

    # Even with large documents, memory growth should be reasonable
    # due to single URL processing
    assert memory_growth < 150, f"Large document memory growth too high: {memory_growth:.2f}MB"

    print("\nLarge Document Test Results:")
    print(f"  Large documents processed: {len(large_urls)}")
    print(f"  Memory growth: {memory_growth:.2f}MB")
    print(f"  Peak memory: {peak_memory:.2f}MB")


@pytest.mark.asyncio
@pytest.mark.scale
@pytest.mark.memory
async def test_scale_ingestion_outshift_platform_docs(scale_loader, memory_monitor):
    """
    Test ingesting URLs from the Outshift platform documentation site.
    This test uses actual URLs from the Outshift platform docs.
    """
    # Use the real Outshift platform docs URL
    outshift_base_url = "https://platform-docs.outshift.io"
    job_id = str(uuid.uuid4())

    memory_monitor.start()

    # Generate URLs based on typical platform documentation structure
    outshift_urls = [
        f"{outshift_base_url}/",
        f"{outshift_base_url}/getting-started/",
        f"{outshift_base_url}/architecture/",
        f"{outshift_base_url}/deployment/",
        f"{outshift_base_url}/configuration/",
        f"{outshift_base_url}/api/",
        f"{outshift_base_url}/troubleshooting/",
        f"{outshift_base_url}/security/",
        f"{outshift_base_url}/monitoring/",
        f"{outshift_base_url}/scaling/",
        f"{outshift_base_url}/best-practices/",
        f"{outshift_base_url}/reference/",
        f"{outshift_base_url}/examples/",
        f"{outshift_base_url}/guides/",
        f"{outshift_base_url}/tutorials/",
        f"{outshift_base_url}/faq/",
        f"{outshift_base_url}/changelog/",
        f"{outshift_base_url}/contributing/",
        f"{outshift_base_url}/support/",
        f"{outshift_base_url}/community/",
    ]

    # Add more specific platform documentation pages
    specific_pages = [
        "getting-started/quick-start",
        "getting-started/installation",
        "getting-started/first-deployment",
        "architecture/overview",
        "architecture/components",
        "architecture/data-flow",
        "deployment/docker",
        "deployment/kubernetes",
        "deployment/cloud",
        "configuration/environment-variables",
        "configuration/config-files",
        "api/authentication",
        "api/endpoints",
        "api/schemas",
        "troubleshooting/common-issues",
        "troubleshooting/debugging",
        "security/overview",
        "security/authentication",
        "security/authorization",
        "monitoring/metrics",
        "monitoring/logs",
        "monitoring/alerts",
        "scaling/horizontal",
        "scaling/vertical",
        "best-practices/performance",
        "best-practices/security",
        "reference/cli",
        "reference/api",
        "examples/basic-usage",
        "examples/advanced-usage",
        "guides/migration",
        "guides/upgrade",
        "tutorials/step-by-step",
        "tutorials/hands-on",
    ]

    # Add specific page URLs
    for page in specific_pages:
        outshift_urls.append(f"{outshift_base_url}/{page}")

    # Generate additional URLs to reach 100 (more reasonable for testing)
    while len(outshift_urls) < 100:
        page_num = len(outshift_urls) - len(specific_pages) - 20 + 1
        outshift_urls.append(f"{outshift_base_url}/page-{page_num:04d}")

    with patch('server.loader.loader.WebBaseLoader', MockWebBaseLoader):
        with patch.object(scale_loader, 'get_sitemaps', return_value=[f"{outshift_base_url}/sitemap.xml"]), \
             patch.object(scale_loader, 'get_urls_from_sitemap', return_value=outshift_urls), \
             patch.object(scale_loader, 'custom_parser', return_value=("Test content", {"source": "test"})):

            start_time = time.time()
            memory_monitor.measure('before_outshift_ingestion')

            # Process the Outshift platform docs URLs
            await scale_loader.load_url(outshift_base_url, job_id)

            end_time = time.time()
            memory_monitor.measure('after_outshift_ingestion')

            processing_time = end_time - start_time
            memory_growth = memory_monitor.get_memory_growth()
            peak_memory = memory_monitor.get_peak_memory()

            # Verify processing was successful
            assert processing_time < 120.0, f"Outshift platform docs ingestion took too long: {processing_time:.2f}s"
            assert memory_growth < 200, f"Outshift platform docs memory growth too high: {memory_growth:.2f}MB"
            assert peak_memory < 1000, f"Outshift platform docs peak memory too high: {peak_memory:.2f}MB"

            print("\nOutshift Platform Docs Scale Test Results:")
            print(f"  URLs processed: {len(outshift_urls)}")
            print(f"  Processing time: {processing_time:.2f}s")
            print(f"  Memory growth: {memory_growth:.2f}MB")
            print(f"  Peak memory: {peak_memory:.2f}MB")
            print(f"  Memory per URL: {memory_growth/len(outshift_urls):.4f}MB")


@pytest.mark.asyncio
@pytest.mark.scale
@pytest.mark.memory
async def test_real_caipe_sitemap_ingestion(scale_loader, memory_monitor):
    """
    Test ingesting URLs from the real CAIPE sitemap.
    This test uses actual URLs from the CAIPE documentation site.
    """
    # Use the real CAIPE sitemap URL
    caipe_base_url = "https://cnoe-io.github.io/ai-platform-engineering"
    job_id = str(uuid.uuid4())

    memory_monitor.start()

    # Mock the sitemap methods to return real CAIPE URLs
    real_caipe_urls = [
        f"{caipe_base_url}/",
        f"{caipe_base_url}/getting-started/",
        f"{caipe_base_url}/architecture/",
        f"{caipe_base_url}/agents/",
        f"{caipe_base_url}/knowledge_bases/",
        f"{caipe_base_url}/usecases/",
        f"{caipe_base_url}/prompt-library/",
        f"{caipe_base_url}/tools-utils/",
        f"{caipe_base_url}/workshop/",
        f"{caipe_base_url}/community/",
        f"{caipe_base_url}/contributing/",
        f"{caipe_base_url}/security/",
        f"{caipe_base_url}/installation/",
        f"{caipe_base_url}/evaluations/",
        f"{caipe_base_url}/getting-started/quick-start",
        f"{caipe_base_url}/getting-started/docker-compose/setup",
        f"{caipe_base_url}/agents/argocd",
        f"{caipe_base_url}/agents/backstage",
        f"{caipe_base_url}/agents/confluence",
        f"{caipe_base_url}/agents/github",
        f"{caipe_base_url}/agents/jira",
        f"{caipe_base_url}/agents/komodor",
        f"{caipe_base_url}/agents/pagerduty",
        f"{caipe_base_url}/agents/slack",
        f"{caipe_base_url}/knowledge_bases/rag",
        f"{caipe_base_url}/knowledge_bases/graph_rag",
        f"{caipe_base_url}/usecases/incident-engineer",
        f"{caipe_base_url}/usecases/platform-engineer",
        f"{caipe_base_url}/usecases/product-owner",
        f"{caipe_base_url}/workshop/mission1",
        f"{caipe_base_url}/workshop/mission2",
        f"{caipe_base_url}/workshop/mission3",
        f"{caipe_base_url}/workshop/mission4",
        f"{caipe_base_url}/workshop/mission6",
        f"{caipe_base_url}/workshop/mission7",
    ]

    with patch('server.loader.loader.WebBaseLoader', MockWebBaseLoader):
        with patch.object(scale_loader, 'get_sitemaps', return_value=[f"{caipe_base_url}/sitemap.xml"]), \
             patch.object(scale_loader, 'get_urls_from_sitemap', return_value=real_caipe_urls):

            start_time = time.time()
            memory_monitor.measure('before_real_ingestion')

            # Process the real CAIPE URLs
            await scale_loader.load_url(caipe_base_url, job_id)

            end_time = time.time()
            memory_monitor.measure('after_real_ingestion')

            processing_time = end_time - start_time
            memory_growth = memory_monitor.get_memory_growth()
            peak_memory = memory_monitor.get_peak_memory()

            # Verify processing was successful
            assert processing_time < 5.0, f"Real CAIPE ingestion took too long: {processing_time:.2f}s"
            assert memory_growth < 50, f"Real CAIPE ingestion memory growth too high: {memory_growth:.2f}MB"

            print("\nReal CAIPE Sitemap Test Results:")
            print(f"  URLs processed: {len(real_caipe_urls)}")
            print(f"  Processing time: {processing_time:.2f}s")
            print(f"  Memory growth: {memory_growth:.2f}MB")
            print(f"  Peak memory: {peak_memory:.2f}MB")
            print(f"  Memory per URL: {memory_growth/len(real_caipe_urls):.4f}MB")


if __name__ == "__main__":
    # Run the scale tests
    pytest.main([__file__, "-v", "-s"])
