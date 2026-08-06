"""
Webloader Ingestor - Main entry point for web content ingestion.

This ingestor listens for URL ingestion requests via Redis and uses a Scrapy
worker pool to crawl and extract content from websites.

NOTE: Scrapy runs in separate subprocess workers to avoid Twisted/asyncio
event loop conflicts. The main process uses pure asyncio.
"""

import os
import time
import traceback
import uuid

from redis.asyncio import Redis

from common.ingestor import IngestorBuilder, Client
from common.ingestor_listener import run_ingestor_listener
from common.models.rag import DataSourceInfo
from common.models.server import UrlIngestRequest, WebIngestorCommand, UrlReloadRequest, ScrapySettings, CrawlMode
from common.job_manager import JobStatus, JobManager
from common.constants import WEBLOADER_INGESTOR_NAME, WEBLOADER_INGESTOR_TYPE, MIN_RELOAD_INTERVAL
from common.utils import get_logger, generate_datasource_id_from_url

from loader.scrapy_loader import ScrapyLoader
from loader.worker_pool import get_worker_pool, shutdown_worker_pool
from loader.worker_types import CrawlDocuments, CrawlRequest, CrawlStatus

logger = get_logger(__name__)

# Redis configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# Webloader configuration
CHECK_INTERVAL = int(
  os.getenv("WEBLOADER_CHECK_INTERVAL", os.getenv("SYNC_INTERVAL", "600"))
)  # How often to check whether datasources are due for reload.
MAX_INGESTION_TASKS = int(
  os.getenv("WEBLOADER_MAX_INGESTION_TASKS", os.getenv("MAX_CONCURRENT_JOBS", "5"))
)  # Max concurrent on-demand ingestion tasks.
PREVIEW_MAX_ITEMS = max(1, min(int(os.getenv("INGESTOR_PREVIEW_MAX_ITEMS", "100")), 500))

redis_client = Redis.from_url(REDIS_URL, decode_responses=True)


def _get_effective_settings(request: UrlIngestRequest, datasource_id: str) -> tuple[ScrapySettings, list[str]]:
  """
  Get effective settings, mapping deprecated fields if present.

  Args:
      request: The URL ingest request
      datasource_id: ID of the datasource (for logging)

  Returns:
      Tuple of (effective_settings, list_of_deprecated_field_names)
  """
  # Start with provided settings or defaults
  settings = request.settings or ScrapySettings()
  deprecated_fields = []

  # Map deprecated check_for_sitemaps -> crawl_mode
  if request.check_for_sitemaps is not None:
    deprecated_fields.append("check_for_sitemaps")
    logger.warning(f"Deprecated field 'check_for_sitemaps' detected for datasource '{datasource_id}'. Use 'settings.crawl_mode' instead. Delete and re-ingest datasource to update.")
    # Only apply if crawl_mode is still default (single)
    if settings.crawl_mode == CrawlMode.SINGLE_URL:
      settings.crawl_mode = CrawlMode.SITEMAP if request.check_for_sitemaps else CrawlMode.SINGLE_URL

  # Map deprecated sitemap_max_urls -> max_pages
  if request.sitemap_max_urls is not None:
    deprecated_fields.append("sitemap_max_urls")
    logger.warning(f"Deprecated field 'sitemap_max_urls' detected for datasource '{datasource_id}'. Use 'settings.max_pages' instead. Delete and re-ingest datasource to update.")
    # Only apply if max_pages is still default (2000)
    if settings.max_pages == 2000:
      settings.max_pages = request.sitemap_max_urls

  # Log warning for deprecated ingest_type (no mapping needed)
  if request.ingest_type is not None:
    deprecated_fields.append("ingest_type")
    logger.warning(f"Deprecated field 'ingest_type' detected for datasource '{datasource_id}'. This field is no longer used. Delete and re-ingest datasource to update.")

  return settings, deprecated_fields


async def process_url_ingestion(client: Client, job_manager: JobManager, url_request: UrlIngestRequest, job_id: str) -> None:
  """Process a single URL ingestion request."""
  try:
    # Generate datasource ID from URL
    datasource_id = generate_datasource_id_from_url(url_request.url)

    # Fetch existing datasource (created by server)
    datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
    datasource_info = next((ds for ds in datasources if ds.datasource_id == datasource_id), None)

    if not datasource_info:
      logger.error(f"Datasource not found: {datasource_id}")
      raise ValueError(f"Datasource not found: {datasource_id}")

    job = await job_manager.get_job(job_id)
    if not job or job.datasource_id != datasource_id:
      raise ValueError(f"Job {job_id} does not belong to datasource {datasource_id}")

    # Check if job was terminated before we started
    if job.status == JobStatus.TERMINATED:
      logger.info(f"Job {job_id} was already terminated, skipping processing")
      return

    # Update job status to IN_PROGRESS
    await job_manager.upsert_job(job_id=job_id, status=JobStatus.IN_PROGRESS, message=f"Starting URL ingestion for {url_request.url}")
    logger.info(f"Processing job: {job_id} for datasource: {datasource_id}")

    # Get effective settings, mapping deprecated fields if present
    settings, deprecated_fields = _get_effective_settings(url_request, datasource_id)

    # Add warning to job status if deprecated fields detected
    if deprecated_fields:
      fields_str = ", ".join(deprecated_fields)
      await job_manager.upsert_job(job_id=job_id, status=JobStatus.IN_PROGRESS, message=f"Warning: Deprecated settings detected ({fields_str}). Delete and re-ingest to update.")

    # Process the URL using ScrapyLoader (which uses worker pool)
    loader = ScrapyLoader(
      rag_client=client,
      job_manager=job_manager,
      datasource_info=datasource_info,
    )
    await loader.load(
      url=url_request.url,
      settings=settings,
      job_id=job_id,
    )

    logger.info(f"Completed URL ingestion for {url_request.url}")

  except Exception as e:
    error_msg = f"Error processing URL {url_request.url}: {str(e)}"
    logger.error(error_msg)
    logger.error(traceback.format_exc())

    # Try to update job with error if we have job_id
    try:
      if job_id:
        await job_manager.add_error_msg(job_id, error_msg)
    except Exception:
      pass

    raise


async def preview_url_ingestion(
  client: Client,
  url_request: UrlIngestRequest,
) -> dict[str, object]:
  """Crawl a bounded sample using the real crawler without persisting it."""
  datasource_id = generate_datasource_id_from_url(url_request.url)
  settings, _ = _get_effective_settings(url_request, datasource_id)
  requested_max_pages = settings.max_pages
  preview_max_pages = min(requested_max_pages, PREVIEW_MAX_ITEMS)
  preview_job_id = f"preview-{uuid.uuid4()}"
  request = CrawlRequest(
    job_id=preview_job_id,
    url=url_request.url,
    datasource_id=datasource_id,
    crawl_mode=settings.crawl_mode.value,
    max_depth=settings.max_depth,
    max_pages=preview_max_pages,
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
    allow_non_public_urls=settings.allow_non_public_urls,
    ingestor_id=client.ingestor_id or "",
    datasource_name=url_request.description or url_request.url,
    reload_interval=url_request.reload_interval or 86400,
  )
  items_by_url: dict[str, dict[str, str]] = {}

  async def collect_documents(batch: CrawlDocuments) -> bool:
    for document in batch.documents:
      metadata = document.get("metadata", {})
      nested = metadata.get("metadata", {}) if isinstance(metadata, dict) else {}
      source = nested.get("source") if isinstance(nested, dict) else None
      if not isinstance(source, str) or not source:
        continue
      title = metadata.get("title") if isinstance(metadata, dict) else None
      items_by_url[source] = {
        "id": str(document.get("id") or source),
        "title": title if isinstance(title, str) and title else source,
        "url": source,
      }
    return True

  pool = await get_worker_pool()
  result = await pool.crawl(
    request=request,
    on_progress=None,
    on_documents=collect_documents,
    timeout=min(110, max(30, preview_max_pages * settings.page_load_timeout)),
  )
  if result.status == CrawlStatus.FAILED:
    raise RuntimeError(result.fatal_error or f"Failed to preview {url_request.url}")

  sitemap_preview = result.urls_found_in_sitemap > 0
  discovered = (
    result.urls_matched_in_sitemap
    if sitemap_preview
    else result.pages_crawled
  )
  hit_recursive_preview_limit = (
    not sitemap_preview
    and requested_max_pages > preview_max_pages
    and result.pages_crawled >= preview_max_pages
  )
  return {
    "items": list(items_by_url.values()),
    "total_discovered": discovered,
    "total_is_exact": sitemap_preview,
    "truncated": (
      hit_recursive_preview_limit
      or result.urls_filtered_max_pages > 0
      or discovered > len(items_by_url)
    ),
    "warnings": result.errors[:10],
    "summary": {
      "pages_crawled": result.pages_crawled,
      "pages_failed": result.pages_failed,
      "crawl_mode": settings.crawl_mode.value,
      "preview_limit": preview_max_pages,
      "sitemap_url": result.sitemap_url_used,
    },
  }


async def reload_datasource(
  client: Client,
  job_manager: JobManager,
  datasource_info: DataSourceInfo,
  job_id: str | None = None,
) -> None:
  """Reload a single datasource."""
  # Extract UrlIngestRequest from metadata
  if not datasource_info.metadata:
    message = f"No metadata for datasource {datasource_info.datasource_id}"
    if job_id is not None:
      raise ValueError(message)
    logger.warning(f"{message}, skipping")
    return

  url_ingest_request_data = datasource_info.metadata.get("url_ingest_request")
  if not url_ingest_request_data:
    message = f"No url_ingest_request in metadata for {datasource_info.datasource_id}"
    if job_id is not None:
      raise ValueError(message)
    logger.warning(f"{message}, skipping")
    return

  # Parse the UrlIngestRequest model
  url_request = UrlIngestRequest.model_validate(url_ingest_request_data)

  logger.info(f"Reloading datasource: {datasource_info.datasource_id}")

  if job_id is None:
    job_response = await client.create_job(
      datasource_id=datasource_info.datasource_id,
      job_status=JobStatus.IN_PROGRESS,
      message=f"Reloading data from {url_request.url}",
    )
    job_id = job_response["job_id"]
  else:
    await job_manager.upsert_job(
      job_id,
      status=JobStatus.IN_PROGRESS,
      message=f"Reloading data from {url_request.url}",
    )

  try:
    # Update datasource last_updated timestamp
    datasource_info.last_updated = int(time.time())
    await client.upsert_datasource(datasource_info)

    # Get effective settings, mapping deprecated fields if present
    settings, deprecated_fields = _get_effective_settings(url_request, datasource_info.datasource_id)

    # Add warning to job status if deprecated fields detected
    if deprecated_fields:
      fields_str = ", ".join(deprecated_fields)
      await job_manager.upsert_job(job_id=job_id, status=JobStatus.IN_PROGRESS, message=f"Warning: Deprecated settings detected ({fields_str}). Delete and re-ingest to update.")

    # Process the URL using ScrapyLoader (which uses worker pool)
    loader = ScrapyLoader(
      rag_client=client,
      job_manager=job_manager,
      datasource_info=datasource_info,
    )
    await loader.load(
      url=url_request.url,
      settings=settings,
      job_id=job_id,
    )

    logger.info(f"Completed reload for {datasource_info.datasource_id}")

  except Exception as e:
    error_msg = f"Error reloading datasource {datasource_info.datasource_id}: {str(e)}"
    logger.error(error_msg)
    logger.error(traceback.format_exc())

    await job_manager.add_error_msg(job_id, error_msg)

    raise


async def redis_listener(client: Client):
  """Run webloader commands through the shared per-ingestor listener."""

  async def initialize_worker_pool() -> None:
    await get_worker_pool()

  async def shutdown_resources() -> None:
    await shutdown_worker_pool()
    await redis_client.aclose()

  await run_ingestor_listener(
    client,
    ingest_command=WebIngestorCommand.INGEST_URL,
    ingest_model=UrlIngestRequest,
    ingest_handler=process_url_ingestion,
    reload_all_command=WebIngestorCommand.RELOAD_ALL,
    reload_all_handler=periodic_reload,
    reload_datasource_command=WebIngestorCommand.RELOAD_DATASOURCE,
    reload_model=UrlReloadRequest,
    reload_handler=reload_datasource,
    max_tasks=MAX_INGESTION_TASKS,
    describe_ingest=lambda request: f"URL ingestion: {request.url}",
    on_startup=initialize_worker_pool,
    on_shutdown=shutdown_resources,
    preview_command=WebIngestorCommand.PREVIEW_URL,
    preview_model=UrlIngestRequest,
    preview_handler=preview_url_ingestion,
  )


async def periodic_reload(client: Client):
  """
  Reload datasources that are due for refresh based on their individual reload intervals.
  Fetches datasources filtered by ingestor_id and re-ingests only those that are due.
  Called periodically by IngestorBuilder or on-demand via Redis.
  """
  logger.info("Starting datasource reload check...")

  # Ensure worker pool is running before attempting any reloads
  # This handles the race condition where periodic_reload is called before redis_listener has started the pool
  await get_worker_pool()

  job_manager = JobManager(redis_client)
  current_time = int(time.time())

  try:
    datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
    logger.info(f"Found {len(datasources)} datasources to check")

    reloaded_count = 0
    skipped_count = 0

    for datasource_info in datasources:
      try:
        # Get per-datasource reload interval, clamp to minimum to prevent tight loops
        ds_reload_interval = datasource_info.reload_interval
        if ds_reload_interval < MIN_RELOAD_INTERVAL:
          logger.warning(f"Datasource {datasource_info.datasource_id} has reload_interval {ds_reload_interval}s below minimum {MIN_RELOAD_INTERVAL}s, clamping to minimum")
          ds_reload_interval = MIN_RELOAD_INTERVAL

        # Check if datasource is due for reload
        if datasource_info.last_updated is not None:
          time_since_update = current_time - datasource_info.last_updated
          if time_since_update < ds_reload_interval:
            logger.debug(f"Skipping datasource {datasource_info.datasource_id}: last updated {time_since_update}s ago, interval is {ds_reload_interval}s")
            skipped_count += 1
            continue

        # Datasource is due for reload (or has never been updated)
        logger.info(f"Reloading datasource {datasource_info.datasource_id} (interval: {ds_reload_interval}s)")
        await reload_datasource(client, job_manager, datasource_info)
        reloaded_count += 1

      except Exception as e:
        logger.error(f"Error reloading datasource {datasource_info.datasource_id}: {e}")
        logger.error(traceback.format_exc())

    logger.info(f"Datasource reload completed: {reloaded_count} reloaded, {skipped_count} skipped")

  except Exception as e:
    logger.error(f"Error in datasource reload: {e}")
    logger.error(traceback.format_exc())


if __name__ == "__main__":
  try:
    logger.info("Starting Webloader Ingestor...")

    # Build and run the ingestor with standard asyncio
    # No Twisted reactor needed - Scrapy runs in subprocess workers
    # Note: .every(CHECK_INTERVAL) sets how often to check if datasources need reloading
    IngestorBuilder().name(WEBLOADER_INGESTOR_NAME).type(WEBLOADER_INGESTOR_TYPE).description("Default ingestor for websites and sitemaps").metadata({}).sync_with_fn(periodic_reload).with_startup(redis_listener).every(CHECK_INTERVAL).run()

  except KeyboardInterrupt:
    logger.info("Webloader ingestor interrupted by user")
  except Exception as e:
    logger.error(f"Webloader ingestor failed: {e}")
    logger.error(traceback.format_exc())
