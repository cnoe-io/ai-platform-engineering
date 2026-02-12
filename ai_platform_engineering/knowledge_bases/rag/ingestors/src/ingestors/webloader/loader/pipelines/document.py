"""
Document pipeline for converting scraped items to LangChain Documents.

This pipeline batches scraped pages and sends them to the RAG server
for embedding and storage.
"""

import time
from typing import List

from scrapy import Spider
from scrapy.exceptions import DropItem
from langchain_core.documents import Document

from common.models.rag import DocumentMetadata
from common.utils import generate_document_id_from_url, get_logger

from ..items import ScrapedPageItem

logger = get_logger(__name__)


class DocumentPipeline:
  """
  Pipeline that converts ScrapedPageItem to LangChain Documents
  and sends them to the RAG server in batches.
  """

  # Number of documents to batch before sending
  batch_size: int = 100

  def __init__(self):
    self.batch: List[Document] = []
    self.client = None
    self.job_manager = None
    self.datasource_info = None
    self.job_id = None
    self.ingestor_id = None

  @classmethod
  def from_crawler(cls, crawler):
    """
    Create pipeline instance from crawler.

    This is called by Scrapy to instantiate the pipeline.
    """
    pipeline = cls()
    return pipeline

  def open_spider(self, spider: Spider):
    """
    Called when spider opens.

    Initialize pipeline with spider's shared resources.
    """
    self.client = spider.client
    self.job_manager = spider.job_manager
    self.datasource_info = spider.datasource_info
    self.job_id = spider.job_id
    self.ingestor_id = spider.client.ingestor_id

    logger.info(f"Document pipeline opened for job {self.job_id}")

  async def process_item(self, item: ScrapedPageItem, spider: Spider):
    """
    Process a scraped item.

    Converts item to Document and adds to batch. When batch is full,
    sends documents to RAG server.

    Args:
        item: Scraped page item
        spider: Spider instance

    Returns:
        The processed item

    Raises:
        DropItem: If item has no content
    """
    # Validate item
    if not item.content or len(item.content.strip()) < 10:
      logger.warning(f"Dropping item with no content: {item.url}")
      raise DropItem(f"No content extracted from {item.url}")

    # Generate document ID
    doc_id = generate_document_id_from_url(self.datasource_info.datasource_id, item.url)

    # Build metadata
    metadata = DocumentMetadata(
      datasource_id=self.datasource_info.datasource_id,
      document_id=doc_id,
      title=item.title or "",
      description=item.description or "",
      document_type="webpage",
      document_ingested_at=int(time.time()),
      ingestor_id=self.ingestor_id,
      fresh_until=0,  # Will be set by server
      is_graph_entity=False,
      metadata={
        "source": item.url,
        "language": item.language or "",
        "generator": item.generator or "",
        **item.extra_metadata,
      },
    )

    # Create Document
    doc = Document(
      id=doc_id,
      page_content=item.content,
      metadata=metadata.model_dump(),
    )

    # Add to batch
    self.batch.append(doc)

    # Update job progress
    await self.job_manager.increment_progress(self.job_id)

    # Flush batch if full
    if len(self.batch) >= self.batch_size:
      await self._flush_batch()

    return item

  async def close_spider(self, spider: Spider):
    """
    Called when spider closes.

    Flushes any remaining documents in the batch.
    """
    logger.info(f"Closing document pipeline, flushing {len(self.batch)} remaining documents")
    await self._flush_batch()

  async def _flush_batch(self):
    """
    Send current batch to RAG server.
    """
    if not self.batch:
      return

    try:
      logger.info(f"Flushing batch of {len(self.batch)} documents to RAG server")

      await self.client.ingest_documents(
        job_id=self.job_id,
        datasource_id=self.datasource_info.datasource_id,
        documents=self.batch,
      )

      # Clear batch after successful send
      self.batch = []

    except Exception as e:
      logger.error(f"Failed to flush batch: {e}")
      # Keep batch to retry on next flush
      raise
