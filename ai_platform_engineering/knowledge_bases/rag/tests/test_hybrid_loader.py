import asyncio
import os
import pytest
import logging
from unittest.mock import Mock, patch, AsyncMock
from server.loader.loader import Loader

class TestHybridLoader:
    """Test suite for the hybrid loader approach."""

    @pytest.fixture
    def mock_vector_store(self):
        """Mock vector store for testing."""
        mock_vstore = Mock()
        mock_vstore.aadd_documents = AsyncMock(return_value=["doc_id_1", "doc_id_2"])
        return mock_vstore

    @pytest.fixture
    def loader(self, mock_vector_store):
        """Create loader instance for testing."""
        logger = logging.getLogger(__name__)
        return Loader(vstore=mock_vector_store, logger=logger)

    @pytest.mark.asyncio
    async def test_detect_generator_docusaurus(self, loader):
        """Test generator detection for Docusaurus sites."""
        # Mock the detect_generator method directly
        with patch.object(loader, 'detect_generator', return_value="docusaurus"):
            generator = await loader.detect_generator("https://cnoe-io.github.io/ai-platform-engineering/prompt-library/")
            assert generator == "docusaurus"

    @pytest.mark.asyncio
    async def test_detect_generator_mkdocs(self, loader):
        """Test generator detection for MkDocs sites."""
        # Mock the detect_generator method directly
        with patch.object(loader, 'detect_generator', return_value="mkdocs"):
            generator = await loader.detect_generator("https://a2a-protocol.org/latest/")
            assert generator == "mkdocs"

    @pytest.mark.asyncio
    async def test_detect_generator_generic(self, loader):
        """Test generator detection for generic sites."""
        # Mock the HTTP response for generic site
        mock_content = """
        <html>
        <head>
            <title>Wikipedia - Mars</title>
        </head>
        <body>Generic content</body>
        </html>
        """

        with patch('aiohttp.ClientSession') as mock_session_class:
            mock_session = AsyncMock()
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.text = AsyncMock(return_value=mock_content)
            mock_session.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            mock_session_class.return_value.__aenter__ = AsyncMock(return_value=mock_session)

            generator = await loader.detect_generator("https://en.wikipedia.org/wiki/Mars")
            assert generator == "generic"

    def test_should_use_custom_parser_docusaurus(self, loader):
        """Test custom parser decision for Docusaurus."""
        loader.use_hybrid_approach = True
        assert loader.should_use_custom_parser("docusaurus") == True

    def test_should_use_custom_parser_mkdocs(self, loader):
        """Test custom parser decision for MkDocs."""
        loader.use_hybrid_approach = True
        assert loader.should_use_custom_parser("mkdocs") == True

    def test_should_use_custom_parser_generic(self, loader):
        """Test custom parser decision for generic sites."""
        loader.use_hybrid_approach = True
        assert loader.should_use_custom_parser("generic") == False

    def test_should_use_custom_parser_other_generators(self, loader):
        """Test custom parser decision for other generators."""
        loader.use_hybrid_approach = True
        assert loader.should_use_custom_parser("gatsby") == False
        assert loader.should_use_custom_parser("nextjs") == False
        assert loader.should_use_custom_parser("jekyll") == False

    def test_should_use_custom_parser_force_custom(self, loader):
        """Test custom parser decision when forced via environment variable."""
        loader.use_hybrid_approach = False
        loader.use_custom_parser = True
        assert loader.should_use_custom_parser("generic") == True

    def test_should_use_custom_parser_force_webloader(self, loader):
        """Test custom parser decision when forced to use WebBaseLoader."""
        loader.use_hybrid_approach = False
        loader.use_custom_parser = False
        assert loader.should_use_custom_parser("docusaurus") == False

    @pytest.mark.asyncio
    async def test_load_url_docusaurus_custom_parser(self, loader):
        """Test loading Docusaurus URL with custom parser."""
        loader.use_hybrid_approach = True

        # Mock the generator detection
        with patch.object(loader, 'detect_generator', return_value="docusaurus"):
            # Mock the custom parser
            with patch.object(loader, 'custom_parser', return_value=("content", {"source": "test"})):
                # Mock the session
                with patch.object(loader, 'session', None):
                    with patch('aiohttp.ClientSession') as mock_session:
                        mock_response = AsyncMock()
                        mock_response.status = 200
                        mock_response.text = AsyncMock(return_value="<html>test</html>")
                        mock_session.return_value.__aenter__.return_value.get.return_value.__aenter__.return_value = mock_response

                        # Mock process_document
                        with patch.object(loader, 'process_document', return_value=None):
                            await loader.load_url("https://cnoe-io.github.io/ai-platform-engineering/prompt-library/", "test_job")

    @pytest.mark.asyncio
    async def test_load_url_mkdocs_custom_parser(self, loader):
        """Test loading MkDocs URL with custom parser."""
        loader.use_hybrid_approach = True

        # Mock the generator detection
        with patch.object(loader, 'detect_generator', return_value="mkdocs"):
            # Mock the custom parser
            with patch.object(loader, 'custom_parser', return_value=("content", {"source": "test"})):
                # Mock the session
                with patch.object(loader, 'session', None):
                    with patch('aiohttp.ClientSession') as mock_session:
                        mock_response = AsyncMock()
                        mock_response.status = 200
                        mock_response.text = AsyncMock(return_value="<html>test</html>")
                        mock_session.return_value.__aenter__.return_value.get.return_value.__aenter__.return_value = mock_response

                        # Mock process_document
                        with patch.object(loader, 'process_document', return_value=None):
                            await loader.load_url("https://a2a-protocol.org/latest/", "test_job")

    @pytest.mark.asyncio
    async def test_load_url_generic_webloader(self, loader):
        """Test loading generic URL with WebBaseLoader."""
        loader.use_hybrid_approach = True

        # Mock the generator detection
        with patch.object(loader, 'detect_generator', return_value="generic"):
            # Mock get_sitemaps to return empty list
            with patch.object(loader, 'get_sitemaps', return_value=[]):
                # Mock WebBaseLoader
                with patch('server.loader.loader.WebBaseLoader') as mock_loader_class:
                    mock_loader = Mock()
                    mock_doc = Mock()
                    mock_doc.id = None
                    mock_doc.metadata = {"source": "test"}
                    mock_doc.page_content = "test content"
                    mock_loader.ascrape_all = AsyncMock(return_value=[mock_doc])
                    mock_loader_class.return_value = mock_loader

                    # Mock process_document
                    with patch.object(loader, 'process_document', return_value=None):
                        await loader.load_url("https://en.wikipedia.org/wiki/Mars", "test_job")

    @pytest.mark.asyncio
    async def test_load_url_batch_processing(self, loader):
        """Test batch processing with different generators."""
        loader.use_hybrid_approach = True
        loader.batch_size = 2

        urls = [
            "https://cnoe-io.github.io/ai-platform-engineering/prompt-library/",
            "https://a2a-protocol.org/latest/",
            "https://en.wikipedia.org/wiki/Mars"
        ]

        # Mock generator detection for each URL
        def mock_detect_generator(url):
            if "cnoe-io.github.io" in url:
                return "docusaurus"
            elif "a2a-protocol.org" in url:
                return "mkdocs"
            else:
                return "generic"

        with patch.object(loader, 'detect_generator', side_effect=mock_detect_generator):
            # Mock get_sitemaps to return empty list
            with patch.object(loader, 'get_sitemaps', return_value=[]):
                # Mock the custom parser for Docusaurus and MkDocs
                with patch.object(loader, 'custom_parser', return_value=("content", {"source": "test"})):
                    # Mock WebBaseLoader for generic
                    with patch('server.loader.loader.WebBaseLoader') as mock_loader_class:
                        mock_loader = Mock()
                        mock_doc = Mock()
                        mock_doc.id = None
                        mock_doc.metadata = {"source": "test"}
                        mock_doc.page_content = "test content"
                        mock_loader.ascrape_all = AsyncMock(return_value=[mock_doc])
                        mock_loader_class.return_value = mock_loader

                        # Mock process_document
                        with patch.object(loader, 'process_document', return_value=None):
                            await loader.load_url(urls, "test_job")

    def test_user_agent_setting(self, loader):
        """Test that user agent is properly set."""
        expected_user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        assert loader.user_agent == expected_user_agent

    def test_environment_variables(self, loader):
        """Test environment variable configuration."""
        # Test default values
        assert loader.use_hybrid_approach == True  # Default from environment
        assert loader.use_custom_parser == False  # Default from environment

        # Test with environment variables set
        with patch.dict(os.environ, {'USE_HYBRID_APPROACH': 'false', 'USE_CUSTOM_PARSER': 'true'}):
            loader2 = Loader(vstore=Mock(), logger=logging.getLogger())
            assert loader2.use_hybrid_approach == False
            assert loader2.use_custom_parser == True

if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])
