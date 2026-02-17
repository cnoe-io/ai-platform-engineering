"""
Simple tests for the document pipeline.

These tests verify that the pipeline correctly converts ScrapedPageItem
objects to LangChain Documents and handles validation.
"""

import pytest
from unittest.mock import Mock, AsyncMock


# ============================================================================
# Test Fixtures
# ============================================================================


def make_mock_spider():
  """Create a mock spider with required attributes."""
  spider = Mock()
  spider.client = Mock()
  spider.client.ingestor_id = "test-ingestor-123"
  spider.client.ingest_documents = AsyncMock()
  spider.job_manager = Mock()
  spider.job_manager.increment_progress = AsyncMock()
  spider.datasource_info = Mock()
  spider.datasource_info.datasource_id = "test-datasource-456"
  spider.job_id = "test-job-789"
  return spider


def make_scraped_item(
  url: str = "https://example.com/page",
  content: str = "This is the page content with enough text.",
  title: str = "Test Page",
  description: str = "A test page description",
  language: str = "en",
  generator: str = None,
):
  """Create a ScrapedPageItem for testing."""
  from ingestors.webloader.loader.items import ScrapedPageItem

  return ScrapedPageItem(
    url=url,
    content=content,
    title=title,
    description=description,
    language=language,
    generator=generator,
  )


# ============================================================================
# Pipeline Initialization Tests
# ============================================================================


class TestPipelineInitialization:
  """Tests for pipeline initialization."""

  def test_pipeline_creates_empty_batch(self):
    """Pipeline should initialize with an empty batch."""
    from ingestors.webloader.loader.pipelines.document import DocumentPipeline

    pipeline = DocumentPipeline()

    assert pipeline.batch == []
    assert pipeline.client is None
    assert pipeline.job_id is None

  def test_open_spider_initializes_from_spider(self):
    """open_spider should copy attributes from spider."""
    from ingestors.webloader.loader.pipelines.document import DocumentPipeline

    pipeline = DocumentPipeline()
    spider = make_mock_spider()

    pipeline.open_spider(spider)

    assert pipeline.client == spider.client
    assert pipeline.job_manager == spider.job_manager
    assert pipeline.datasource_info == spider.datasource_info
    assert pipeline.job_id == "test-job-789"
    assert pipeline.ingestor_id == "test-ingestor-123"


# ============================================================================
# Item Processing Tests
# ============================================================================


class TestItemProcessing:
  """Tests for process_item functionality."""

  @pytest.mark.asyncio
  async def test_process_item_creates_document(self):
    """process_item should add a Document to the batch."""
    from ingestors.webloader.loader.pipelines.document import DocumentPipeline

    pipeline = DocumentPipeline()
    spider = make_mock_spider()
    pipeline.open_spider(spider)

    item = make_scraped_item()
    result = await pipeline.process_item(item, spider)

    # Should return the item
    assert result == item

    # Should have one document in batch
    assert len(pipeline.batch) == 1

    # Document should have correct content
    doc = pipeline.batch[0]
    assert doc.page_content == item.content
    assert doc.metadata["title"] == "Test Page"
    assert doc.metadata["description"] == "A test page description"

  @pytest.mark.asyncio
  async def test_process_item_increments_progress(self):
    """process_item should call increment_progress on job manager."""
    from ingestors.webloader.loader.pipelines.document import DocumentPipeline

    pipeline = DocumentPipeline()
    spider = make_mock_spider()
    pipeline.open_spider(spider)

    item = make_scraped_item()
    await pipeline.process_item(item, spider)

    spider.job_manager.increment_progress.assert_called_once_with("test-job-789")

  @pytest.mark.asyncio
  async def test_drops_item_with_no_content(self):
    """process_item should drop items with empty content."""
    from ingestors.webloader.loader.pipelines.document import DocumentPipeline
    from scrapy.exceptions import DropItem

    pipeline = DocumentPipeline()
    spider = make_mock_spider()
    pipeline.open_spider(spider)

    item = make_scraped_item(content="")

    with pytest.raises(DropItem):
      await pipeline.process_item(item, spider)

    # Batch should still be empty
    assert len(pipeline.batch) == 0

  @pytest.mark.asyncio
  async def test_drops_item_with_short_content(self):
    """process_item should drop items with content shorter than 10 chars."""
    from ingestors.webloader.loader.pipelines.document import DocumentPipeline
    from scrapy.exceptions import DropItem

    pipeline = DocumentPipeline()
    spider = make_mock_spider()
    pipeline.open_spider(spider)

    item = make_scraped_item(content="Short")  # Less than 10 chars

    with pytest.raises(DropItem):
      await pipeline.process_item(item, spider)


# ============================================================================
# Batch Flushing Tests
# ============================================================================


class TestBatchFlushing:
  """Tests for batch flushing behavior."""

  @pytest.mark.asyncio
  async def test_flushes_batch_when_full(self):
    """Pipeline should flush batch when batch_size is reached."""
    from ingestors.webloader.loader.pipelines.document import DocumentPipeline

    pipeline = DocumentPipeline()
    pipeline.batch_size = 3  # Small batch for testing
    spider = make_mock_spider()
    pipeline.open_spider(spider)

    # Add items up to batch size
    for i in range(3):
      item = make_scraped_item(
        url=f"https://example.com/page{i}",
        content=f"Content for page {i} with enough text",
      )
      await pipeline.process_item(item, spider)

    # Should have called ingest_documents
    spider.client.ingest_documents.assert_called_once()

    # Batch should be empty after flush
    assert len(pipeline.batch) == 0

  @pytest.mark.asyncio
  async def test_close_spider_flushes_remaining(self):
    """close_spider should flush remaining documents."""
    from ingestors.webloader.loader.pipelines.document import DocumentPipeline

    pipeline = DocumentPipeline()
    pipeline.batch_size = 100  # Large batch
    spider = make_mock_spider()
    pipeline.open_spider(spider)

    # Add a few items (less than batch_size)
    for i in range(3):
      item = make_scraped_item(
        url=f"https://example.com/page{i}",
        content=f"Content for page {i} with enough text",
      )
      await pipeline.process_item(item, spider)

    # ingest_documents should not have been called yet
    spider.client.ingest_documents.assert_not_called()

    # Close spider
    await pipeline.close_spider(spider)

    # Now it should have been called
    spider.client.ingest_documents.assert_called_once()


# ============================================================================
# Document Metadata Tests
# ============================================================================


class TestDocumentMetadata:
  """Tests for document metadata generation."""

  @pytest.mark.asyncio
  async def test_document_has_correct_metadata_structure(self):
    """Generated documents should have correct metadata structure."""
    from ingestors.webloader.loader.pipelines.document import DocumentPipeline

    pipeline = DocumentPipeline()
    spider = make_mock_spider()
    pipeline.open_spider(spider)

    item = make_scraped_item(
      url="https://example.com/docs/guide",
      title="User Guide",
      description="How to use the product",
      language="en",
      generator="Docusaurus v2.4",
    )
    await pipeline.process_item(item, spider)

    doc = pipeline.batch[0]
    metadata = doc.metadata

    # Check required fields
    assert metadata["datasource_id"] == "test-datasource-456"
    assert metadata["ingestor_id"] == "test-ingestor-123"
    assert metadata["document_type"] == "webpage"
    assert metadata["title"] == "User Guide"
    assert metadata["description"] == "How to use the product"

    # Check nested metadata
    assert metadata["metadata"]["source"] == "https://example.com/docs/guide"
    assert metadata["metadata"]["language"] == "en"
    assert metadata["metadata"]["generator"] == "Docusaurus v2.4"

  @pytest.mark.asyncio
  async def test_document_id_is_generated_from_url(self):
    """Document ID should be deterministically generated from URL."""
    from ingestors.webloader.loader.pipelines.document import DocumentPipeline

    pipeline = DocumentPipeline()
    spider = make_mock_spider()
    pipeline.open_spider(spider)

    item = make_scraped_item(url="https://example.com/docs/page")
    await pipeline.process_item(item, spider)

    doc = pipeline.batch[0]

    # ID should exist and be non-empty
    assert doc.id is not None
    assert len(doc.id) > 0

    # Same URL should generate same ID
    item2 = make_scraped_item(url="https://example.com/docs/page")
    await pipeline.process_item(item2, spider)

    doc2 = pipeline.batch[1]
    assert doc.id == doc2.id
