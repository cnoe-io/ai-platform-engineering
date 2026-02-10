"""
Scrapy-based web loader for scraping and ingesting web content.

This module provides the main entry point for Scrapy-based web scraping,
using a subprocess worker pool to avoid Twisted/asyncio event loop conflicts.
"""

import gc

from langchain_core.documents import Document

from common.models.server import ScrapySettings
from common.models.rag import DataSourceInfo
from common.job_manager import JobManager, JobStatus
from common.ingestor import Client
from common.utils import get_logger

from .worker_pool import get_worker_pool
from .worker_types import CrawlRequest, CrawlProgress, CrawlResult, CrawlStatus

logger = get_logger(__name__)


class ScrapyLoader:
  """
  Main entry point for Scrapy-based web scraping.

  This class manages crawl requests using a worker pool and handles
  document ingestion to the RAG server.
  """

  def __init__(
    self,
    rag_client: Client,
    job_manager: JobManager,
    datasource_info: DataSourceInfo,
  ):
    """
    Initialize the Scrapy loader.

    Args:
        rag_client: Client for communicating with RAG server
        job_manager: Manager for job status updates
        datasource_info: Metadata about the datasource
    """
    self.client = rag_client
    self.job_manager = job_manager
    self.datasource_info = datasource_info
    self.logger = get_logger(f"scrapy-loader:{datasource_info.datasource_id[:12]}")

  async def load(
    self,
    url: str,
    settings: ScrapySettings,
    job_id: str,
  ) -> None:
    """
    Load content from a URL using Scrapy worker pool.

    Args:
        url: URL to scrape
        settings: Scraping configuration
        job_id: ID of the ingestion job
    """
    self.logger.info(f"Starting Scrapy crawl for {url} with mode {settings.crawl_mode}")

    try:
      # Update job status with mode info
      if settings.render_javascript:
        await self.job_manager.upsert_job(
          job_id=job_id,
          status=JobStatus.IN_PROGRESS,
          message=f"Starting {settings.crawl_mode.value} crawl with JavaScript rendering (Chromium)",
        )
        self.logger.info("JavaScript rendering enabled - using Playwright/Chromium")
      else:
        await self.job_manager.upsert_job(
          job_id=job_id,
          status=JobStatus.IN_PROGRESS,
          message=f"Starting {settings.crawl_mode.value} crawl of {url}",
        )

      # Get worker pool
      pool = await get_worker_pool()

      # Build crawl request
      request = CrawlRequest(
        job_id=job_id,
        url=url,
        datasource_id=self.datasource_info.datasource_id,
        crawl_mode=settings.crawl_mode.value,
        max_depth=settings.max_depth,
        max_pages=settings.max_pages,
        render_javascript=settings.render_javascript,
        wait_for_selector=settings.wait_for_selector,
        page_load_timeout=settings.page_load_timeout,
        follow_external_links=settings.follow_external_links,
        allowed_url_patterns=settings.allowed_url_patterns,
        denied_url_patterns=settings.denied_url_patterns,
        download_delay=settings.download_delay,
        concurrent_requests=settings.concurrent_requests,
        respect_robots_txt=settings.respect_robots_txt,
        user_agent=settings.user_agent,
        ingestor_id=self.client.ingestor_id or "",
        datasource_name=getattr(self.datasource_info, "name", "") or "",
      )

      # Progress tracking state
      last_pages_crawled = 0
      total_set = False

      # Progress callback
      async def on_progress(progress: CrawlProgress):
        nonlocal last_pages_crawled, total_set

        # Set total if we now know it (from sitemap) and haven't set it yet
        if progress.total_pages and not total_set:
          await self.job_manager.upsert_job(
            job_id=job_id,
            status=JobStatus.IN_PROGRESS,
            message=progress.message,
            total=progress.total_pages,
          )
          total_set = True
        else:
          await self.job_manager.upsert_job(
            job_id=job_id,
            status=JobStatus.IN_PROGRESS,
            message=progress.message,
          )

        # Increment progress counter by the delta
        delta = progress.pages_crawled - last_pages_crawled
        if delta > 0:
          await self.job_manager.increment_progress(job_id, delta)
          last_pages_crawled = progress.pages_crawled

      # Run crawl
      self.logger.info(f"Submitting crawl to worker pool: {url}")
      result = await pool.crawl(
        request=request,
        on_progress=on_progress,
        timeout=settings.max_pages * 30,  # ~30 seconds per page max
      )

      self.logger.info(f"Crawl completed: {result.pages_crawled} pages, status: {result.status}")

      # Process results
      await self._process_result(result, job_id, url)

    except Exception as e:
      self.logger.error(f"Crawl failed: {e}")

      await self.job_manager.upsert_job(
        job_id=job_id,
        status=JobStatus.FAILED,
        message=f"Crawl failed: {str(e)}",
      )

      raise

    finally:
      gc.collect()

  async def _process_result(self, result: CrawlResult, job_id: str, url: str):
    """
    Process crawl result and ingest documents.

    Args:
        result: Crawl result from worker
        job_id: Job ID
        url: Original URL
    """
    if result.status == CrawlStatus.FAILED:
      fatal_error = result.fatal_error or f"Failed to crawl {url}"
      self.logger.error(f"Crawl failed: {fatal_error}")

      # Log filtering stats for debugging
      if result.urls_found_in_sitemap > 0:
        self.logger.info(f"Filtering stats: {result.urls_found_in_sitemap} URLs in sitemap, {result.urls_filtered_external} filtered as external, {result.urls_filtered_pattern} filtered by pattern, {result.urls_filtered_max_pages} filtered by max pages")

      # Add individual error messages to the job
      for error in result.errors:
        await self.job_manager.add_error_msg(job_id, error)

      await self.job_manager.upsert_job(
        job_id=job_id,
        status=JobStatus.FAILED,
        message=fatal_error,
      )
      return

    if not result.documents:
      # Build a more helpful message if we have filtering stats
      fatal_error = result.fatal_error
      if not fatal_error:
        if result.urls_found_in_sitemap > 0:
          fatal_error = f"No content extracted from {url}. Found {result.urls_found_in_sitemap} URLs in sitemap but none were successfully scraped."
        else:
          fatal_error = f"No content extracted from {url}"

      self.logger.error(f"No documents extracted: {fatal_error}")

      # Add individual error messages to the job
      for error in result.errors:
        await self.job_manager.add_error_msg(job_id, error)

      await self.job_manager.upsert_job(
        job_id=job_id,
        status=JobStatus.FAILED,
        message=fatal_error,
      )
      return

    # Convert document dicts to LangChain Documents
    documents = []
    for doc_dict in result.documents:
      doc = Document(
        id=doc_dict.get("id"),
        page_content=doc_dict.get("page_content", ""),
        metadata=doc_dict.get("metadata", {}),
      )
      documents.append(doc)

    self.logger.info(f"Ingesting {len(documents)} documents to RAG server")

    # Send to RAG server in batches
    batch_size = 100
    total_batches = (len(documents) + batch_size - 1) // batch_size  # Ceiling division

    for i in range(0, len(documents), batch_size):
      batch = documents[i : i + batch_size]
      batch_num = i // batch_size + 1

      # Update job message with batch progress
      await self.job_manager.upsert_job(
        job_id=job_id,
        status=JobStatus.IN_PROGRESS,
        message=f"Sending batch {batch_num}/{total_batches} to server ({len(batch)} documents)",
      )

      try:
        await self.client.ingest_documents(
          job_id=job_id,
          datasource_id=self.datasource_info.datasource_id,
          documents=batch,
        )
        self.logger.info(f"Ingested batch {batch_num}/{total_batches} ({len(batch)} documents)")

        # Track document count
        await self.job_manager.increment_document_count(job_id, len(batch))

      except Exception as e:
        self.logger.error(f"Failed to ingest batch: {e}")
        # Continue with next batch

    # Update final status
    if result.status == CrawlStatus.PARTIAL:
      # Add individual error messages to the job
      for error in result.errors:
        await self.job_manager.add_error_msg(job_id, error)

      await self.job_manager.upsert_job(
        job_id=job_id,
        status=JobStatus.COMPLETED_WITH_ERRORS,
        message=f"Crawled {result.pages_crawled} pages with {result.pages_failed} errors",
      )
    else:
      await self.job_manager.upsert_job(
        job_id=job_id,
        status=JobStatus.COMPLETED,
        message=f"Successfully crawled {result.pages_crawled} pages in {result.elapsed_seconds:.1f}s",
      )


async def run_scrapy_loader(
  url: str,
  settings: ScrapySettings,
  job_id: str,
  client: Client,
  job_manager: JobManager,
  datasource_info: DataSourceInfo,
) -> None:
  """
  Convenience function to run the Scrapy loader.

  Args:
      url: URL to scrape
      settings: Scraping configuration
      job_id: ID of the ingestion job
      client: RAG server client
      job_manager: Job status manager
      datasource_info: Datasource metadata
  """
  loader = ScrapyLoader(
    rag_client=client,
    job_manager=job_manager,
    datasource_info=datasource_info,
  )

  await loader.load(url=url, settings=settings, job_id=job_id)
