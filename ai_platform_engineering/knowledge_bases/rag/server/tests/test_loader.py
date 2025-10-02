"""
Unit tests for the Loader class.
"""
from asyncio import Lock
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import uuid
import datetime

from server.loader.loader import Loader, MetadataStorage
from common.job_manager import JobManager
from common.models.rag import DataSourceInfo


class TestLoader:
    """Test Loader class functionality."""

    @pytest.fixture
    def mock_redis(self):
        """Mock Redis client for testing."""
        mock_redis = AsyncMock()
        mock_redis.ping.return_value = True
        mock_redis.get.return_value = None
        mock_redis.setex.return_value = True
        mock_redis.keys.return_value = []
        # The lock method should return a context manager, not a coroutine.
        # We use MagicMock here to override the default AsyncMock behavior for the lock attribute.
        mock_redis.lock = MagicMock(return_value=Lock())
        return mock_redis

    @pytest.fixture
    def mock_metadata_storage(self, mock_redis):
        """Mock MetadataStorage for testing."""
        return MetadataStorage(redis_client=mock_redis)

    @pytest.fixture
    def mock_job_manager(self, mock_redis):
        """Mock JobManager for testing."""
        return JobManager(redis_client=mock_redis)

    @pytest.fixture
    def mock_datasource_info(self):
        """Mock DataSourceInfo for testing."""
        return DataSourceInfo(
            datasource_id=f"ds_{uuid.uuid4().hex}",
            source_type="url",
            path="https://example.com",
            default_chunk_size=512,
            default_chunk_overlap=50,
            job_id=f"job_{uuid.uuid4().hex}",
            description="Test description",
            created_at=datetime.datetime.now(),
            last_updated=datetime.datetime.now(),
            total_documents=0,
            total_chunks=0,
            metadata={}
        )

    @pytest.fixture
    def loader(self, mock_vector_db, mock_metadata_storage, mock_datasource_info, mock_job_manager):
        """Create Loader instance for testing."""
        return Loader(mock_vector_db, mock_metadata_storage, mock_datasource_info, mock_job_manager)

    def test_loader_initialization(self, loader, mock_vector_db, mock_metadata_storage, mock_datasource_info, mock_job_manager):
        """Test Loader initialization."""
        assert loader.vstore == mock_vector_db
        assert loader.metadata_storage == mock_metadata_storage
        assert loader.datasourceinfo == mock_datasource_info
        assert loader.jobmanager == mock_job_manager
        assert loader.chunk_size == mock_datasource_info.default_chunk_size
        assert loader.chunk_overlap == mock_datasource_info.default_chunk_overlap
        assert loader.text_splitter is not None

    @pytest.mark.asyncio
    async def test_get_sitemaps_no_sitemaps(self, loader):
        """Test sitemap discovery when no sitemaps exist."""
        url = "https://example.com"

        async with loader:
            with patch.object(loader.session, 'get') as mock_get:
                mock_response = AsyncMock()
                mock_response.status = 404
                mock_get.return_value.__aenter__.return_value = mock_response

                sitemaps = await loader.get_sitemaps(url)

                assert sitemaps == []

    @pytest.mark.asyncio
    async def test_get_sitemaps_with_sitemaps(self, loader):
        """Test sitemap discovery when sitemaps exist."""
        url = "https://example.com"
        sitemap_content = """
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
           <sitemap>
              <loc>https://example.com/sitemap1.xml</loc>
           </sitemap>
        </sitemapindex>
        """

        async with loader:
            with patch.object(loader.session, 'get') as mock_get:
                mock_response = AsyncMock()
                mock_response.status = 200
                mock_response.read = AsyncMock(return_value=sitemap_content.encode('utf-8'))
                mock_response.headers = {'Content-Type': 'application/xml'}
                mock_get.return_value.__aenter__.return_value = mock_response

                # Since get_urls_from_sitemap is recursive, we mock it to avoid infinite loops in test
                with patch.object(loader, 'get_urls_from_sitemap', new_callable=AsyncMock) as mock_get_urls:
                    mock_get_urls.return_value = ["https://example.com/page1"]
                    sitemaps = await loader.get_sitemaps(url)
                    urls = await loader.get_urls_from_sitemap(sitemaps[0])

                    assert "https://example.com/page1" in urls

    @pytest.mark.asyncio
    async def test_get_urls_from_sitemap_success(self, loader):
        """Test URL extraction from sitemap."""
        sitemap_url = "https://example.com/sitemap.xml"
        expected_urls = ["https://example.com/page1", "https://example.com/page2"]

        with patch.object(loader, 'get_urls_from_sitemap', return_value=expected_urls) as mock_method:
            urls = await loader.get_urls_from_sitemap(sitemap_url)

            assert len(urls) == 2
            assert "https://example.com/page1" in urls
            assert "https://example.com/page2" in urls
            mock_method.assert_called_once_with(sitemap_url)

    @pytest.mark.asyncio
    async def test_custom_parser(self, loader):
        from bs4 import BeautifulSoup

        # Create a BeautifulSoup object instead of Document
        html_content = "<html><body><h1>Test Title</h1><p>Test content</p></body></html>"
        soup = BeautifulSoup(html_content, 'html.parser')
        url = "https://example.com"

        content, metadata = await loader.custom_parser(soup, url)

        assert isinstance(content, str)
        assert "Test Title" in content
        assert "Test content" in content
        assert metadata["source"] == url
        assert "title" in metadata

    @pytest.mark.asyncio
    async def test_process_document(self, loader, mock_datasource_info):
        """Test document processing."""
        from langchain_core.documents import Document

        # Create a document with content longer than chunk_size to trigger splitting
        long_content = "Test content " * 1000  # Make it longer than default chunk_size
        doc = Document(
            page_content=long_content,
            metadata={"source": "https://example.com"}
        )

        with patch.object(loader, 'text_splitter') as mock_splitter:
            mock_splitter.split_document.return_value = [doc]
            loader.vstore.aadd_documents = AsyncMock(return_value=["doc_id_1"])

            await loader.process_document(doc, mock_datasource_info.default_chunk_size, mock_datasource_info.default_chunk_overlap)

            # Verify document was added to vector store
            loader.vstore.aadd_documents.assert_called_once()

    @pytest.mark.asyncio
    async def test_load_url_single_url_no_sitemap(self, loader, mock_datasource_info):
        """Test loading single URL without sitemap."""
        url = "https://example.com"

        with patch.object(loader, 'get_sitemaps', return_value=[]), \
             patch.object(loader, 'process_url', new_callable=AsyncMock) as mock_process_url:

            await loader.load_url(url, mock_datasource_info.job_id)

            # Verify process_url was called with the URL
            mock_process_url.assert_called_once_with(url, mock_datasource_info.job_id)

    @pytest.mark.asyncio
    async def test_load_url_with_sitemap(self, loader, mock_datasource_info):
        """Test loading URL with sitemap."""
        url = "https://example.com"
        sitemap_urls = ["https://example.com/sitemap.xml"]
        page_urls = ["https://example.com/page1", "https://example.com/page2"]

        with patch.object(loader, 'get_sitemaps', return_value=sitemap_urls), \
             patch.object(loader, 'get_urls_from_sitemap', return_value=page_urls), \
             patch.object(loader, 'process_url', new_callable=AsyncMock) as mock_process_url:

            await loader.load_url(url, mock_datasource_info.job_id)

            # Verify process_url was called for each URL from the sitemap
            assert mock_process_url.call_count == len(page_urls)
            mock_process_url.assert_any_call(page_urls[0], mock_datasource_info.job_id)
            mock_process_url.assert_any_call(page_urls[1], mock_datasource_info.job_id)

    @pytest.mark.asyncio
    async def test_close(self, loader):
        """Test loader close method."""
        async with loader:
            pass # To initialize session
        await loader.close()

        # Should not raise any exceptions
        assert loader.session is None
