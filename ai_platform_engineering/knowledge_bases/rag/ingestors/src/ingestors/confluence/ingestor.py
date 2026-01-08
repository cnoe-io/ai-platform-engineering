"""Confluence RAG ingestor - syncs pages from Confluence spaces.

Mirrors the webloader ingestor pattern:
- Redis listener handles on-demand page ingestion
- Periodic reload refreshes all configured spaces
- Each Confluence space is a datasource, pages are like URLs within a sitemap
"""

import os
import asyncio
import re
import time
import traceback
from typing import Set, List, Dict, Optional
from urllib.parse import urlparse
from redis.asyncio import Redis
from common.ingestor import IngestorBuilder, Client
from common.models.rag import DataSourceInfo
from common.models.server import (
    IngestorRequest,
    ConfluenceIngestRequest,
    ConfluenceIngestorCommand,
    ConfluenceReloadRequest,
)
from common.job_manager import JobStatus, JobManager
from common.constants import (
    CONFLUENCE_INGESTOR_REDIS_QUEUE,
    CONFLUENCE_INGESTOR_NAME,
    CONFLUENCE_INGESTOR_TYPE,
)
from common.utils import get_logger
from loader import ConfluenceLoader, create_confluence_session, generate_datasource_id

logger = get_logger(__name__)

# Redis configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = Redis.from_url(REDIS_URL, decode_responses=True)

# Confluence configuration
CONFLUENCE_URL = os.environ.get("CONFLUENCE_URL")
if not CONFLUENCE_URL:
    raise ValueError("CONFLUENCE_URL environment variable is required")

CONFLUENCE_USERNAME = os.environ.get("CONFLUENCE_USERNAME")
if not CONFLUENCE_USERNAME:
    raise ValueError("CONFLUENCE_USERNAME environment variable is required")

CONFLUENCE_TOKEN = os.environ.get("CONFLUENCE_TOKEN")
if not CONFLUENCE_TOKEN:
    raise ValueError("CONFLUENCE_TOKEN environment variable is required")

CONFLUENCE_SSL_VERIFY = (
    os.environ.get("CONFLUENCE_SSL_VERIFY", "true").lower() == "true"
)
CONFLUENCE_SPACES = os.environ.get("CONFLUENCE_SPACES", "")
RELOAD_INTERVAL = int(
    os.environ.get("CONFLUENCE_SYNC_INTERVAL", "86400")
)  # 24 hours default
MAX_CONCURRENCY = int(os.environ.get("CONFLUENCE_MAX_CONCURRENCY", "5"))
MAX_INGESTION_TASKS = int(os.environ.get("CONFLUENCE_MAX_INGESTION_TASKS", "5"))
CONFLUENCE_API_PAGE_LIMIT = 100  # Pages per API call
RELOAD_RECENT_THRESHOLD = 60  # Seconds to skip recently updated datasources


def _create_datasource_info(
    datasource_id: str,
    ingestor_id: str,
    space_key: str,
    description: str,
    page_ids: Optional[List[str]] = None,
) -> DataSourceInfo:
    """Create DataSourceInfo with consistent metadata structure."""
    return DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=ingestor_id,
        description=description,
        source_type="confluence",
        metadata={
            "space_key": space_key,
            "page_ids": page_ids,
            "confluence_url": CONFLUENCE_URL,
        },
        last_updated=0,
        default_chunk_size=1000,
        default_chunk_overlap=200,
    )


def parse_confluence_spaces(spaces_config: str) -> Dict[str, Optional[List[str]]]:
    """Parse CONFLUENCE_SPACES environment variable.

    Formats:
    - "SPACE" -> {"SPACE": None}  # Entire space
    - "SPACE:123" -> {"SPACE": ["123"]}  # Specific page
    - "SPACE:123:456" -> {"SPACE": ["123", "456"]}  # Multiple pages
    - "SPACE1,SPACE2:123,SPACE3" -> mixed formats

    Returns:
        Dict mapping space_key to page_ids (None = entire space)
    """
    if not spaces_config:
        return {}

    result = {}
    space_entries = spaces_config.split(",")

    for entry in space_entries:
        entry = entry.strip()
        if ":" in entry:
            parts = entry.split(":", 1)
            space_key = parts[0].strip()
            pages = parts[1]
            page_ids = [p.strip() for p in pages.split(":") if p.strip()]
            result[space_key] = page_ids
        else:
            result[entry] = None  # None = entire space

    return result


async def fetch_space_pages_http(
    session, confluence_url: str, space_key: str, page_ids: Optional[List[str]] = None
) -> List[Dict]:
    """Fetch pages from Confluence space via REST API.

    Uses v1 API (/rest/api/content) which is more stable and widely supported.
    If page_ids provided, fetch only those. Otherwise, enumerate all.
    Uses pagination with limit=100.
    """
    logger.info(
        f"fetch_space_pages_http called with space_key={space_key}, page_ids={page_ids}"
    )
    pages = []

    if page_ids:
        # Fetch specific pages by ID
        for page_id in page_ids:
            try:
                url = f"{confluence_url}/rest/api/content/{page_id}"
                params = {"expand": "body.storage,version,space,history"}
                async with session.get(url, params=params) as resp:
                    if resp.status == 200:
                        page = await resp.json()
                        pages.append(page)
                    else:
                        text = await resp.text()
                        logger.warning(
                            f"Failed to fetch page {page_id}: {resp.status} - {text}"
                        )
            except Exception as e:
                logger.error(f"Error fetching page {page_id}: {e}")
    else:
        # Enumerate all pages in space using v1 API
        start = 0
        limit = CONFLUENCE_API_PAGE_LIMIT

        while True:
            try:
                url = f"{confluence_url}/rest/api/content"
                params = {
                    "spaceKey": space_key,
                    "type": "page",
                    "start": start,
                    "limit": limit,
                    "expand": "body.storage,version,space,history",
                }
                async with session.get(url, params=params) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        batch = data.get("results", [])

                        if not batch:
                            break

                        pages.extend(batch)
                        start += len(batch)

                        # Check if we've fetched all pages
                        if len(batch) < limit:
                            break
                    else:
                        text = await resp.text()
                        logger.error(
                            f"Error fetching pages from {space_key}: {resp.status} - {text}"
                        )
                        break
            except Exception as e:
                logger.error(f"Error enumerating {space_key}: {e}")
                logger.error(traceback.format_exc())
                break

    logger.info(f"Fetched {len(pages)} pages from space {space_key}")
    return pages


async def process_page_ingestion(
    client: Client, job_manager: JobManager, ingest_request: ConfluenceIngestRequest
):
    """Process on-demand page ingestion from Redis (server already created datasource)."""
    try:
        # Parse URL to extract space_key and page_id
        confluence_match = re.search(r"/spaces/([^/]+)/pages/(\d+)", ingest_request.url)
        if not confluence_match:
            logger.error(f"Invalid Confluence URL format: {ingest_request.url}")
            return

        space_key = confluence_match.group(1)
        page_id = confluence_match.group(2)

        # Generate space-level datasource ID
        domain = urlparse(ingest_request.url).netloc.replace(".", "_").replace("-", "_")
        datasource_id = generate_datasource_id(CONFLUENCE_URL, space_key)

        # Fetch space-level datasource
        datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
        datasource_info = next(
            (ds for ds in datasources if ds.datasource_id == datasource_id), None
        )

        # Fetch server-created job
        jobs = await job_manager.get_jobs_by_datasource(datasource_id)

        # Handle missing datasource or job - update job status before raising
        if not datasource_info:
            error_msg = f"Datasource not found: {datasource_id}"
            logger.error(error_msg)
            if jobs:
                await job_manager.upsert_job(
                    job_id=jobs[0].job_id, status=JobStatus.FAILED, message=error_msg
                )
            raise ValueError(error_msg)

        if not jobs:
            error_msg = f"No job found for datasource: {datasource_id}"
            logger.error(error_msg)
            raise ValueError(error_msg)

        job = jobs[0]  # Get the most recent job
        job_id = job.job_id

        # Check if job was terminated before we started
        if job.status == JobStatus.TERMINATED:
            logger.info(f"Job {job_id} was already terminated, skipping processing")
            return

        # Update job status to IN_PROGRESS
        await job_manager.upsert_job(
            job_id=job_id,
            status=JobStatus.IN_PROGRESS,
            message=f"Starting Confluence page ingestion for {ingest_request.url}",
        )
        logger.info(f"Processing job: {job_id} for datasource: {datasource_id}")

        # Create authenticated session
        session = await create_confluence_session(
            CONFLUENCE_URL, CONFLUENCE_USERNAME, CONFLUENCE_TOKEN, CONFLUENCE_SSL_VERIFY
        )

        try:
            # Fetch the single page
            pages = await fetch_space_pages_http(
                session, CONFLUENCE_URL, space_key, [page_id]
            )

            if not pages:
                logger.warning(f"No pages found for {ingest_request.url}")
                return

            # Ingest the page
            async with ConfluenceLoader(
                rag_client=client,
                job_manager=job_manager,
                datasource_info=datasource_info,
                confluence_url=CONFLUENCE_URL,
                username=CONFLUENCE_USERNAME,
                token=CONFLUENCE_TOKEN,
                verify_ssl=CONFLUENCE_SSL_VERIFY,
                max_concurrency=MAX_CONCURRENCY,
            ) as loader:
                await loader.ingest_pages(pages, job_id)

            # Update datasource last_updated timestamp
            datasource_info.last_updated = int(time.time())
            await client.upsert_datasource(datasource_info)

            logger.info(f"Completed page ingestion for {ingest_request.url}")

        finally:
            await session.close()

    except Exception as e:
        error_msg = f"Error processing Confluence page {ingest_request.url}: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())

        # Try to update job with error if we have job_id
        try:
            if "job_id" in locals():
                await job_manager.add_error_msg(job_id, error_msg)
        except Exception:
            pass

        raise


async def reload_datasource(
    client: Client, job_manager: JobManager, datasource_info: DataSourceInfo
):
    """Reload a single Confluence datasource.

    Fetches pages based on page_ids in metadata:
    - If page_ids is [] or None: fetch all pages in the space
    - If page_ids is [id1, id2, ...]: fetch only those specific pages
    """

    try:
        # Extract metadata
        if not datasource_info.metadata:
            logger.warning(f"No metadata for {datasource_info.datasource_id}")
            return

        space_key = datasource_info.metadata.get("space_key")
        if not space_key:
            logger.warning(
                f"No space_key in metadata for {datasource_info.datasource_id}"
            )
            return

        page_ids = datasource_info.metadata.get("page_ids")
        logger.info(
            f"Reloading datasource: {datasource_info.datasource_id} with page_ids: {page_ids}"
        )

        try:
            # Update last_updated timestamp
            datasource_info.last_updated = int(time.time())
            await client.upsert_datasource(datasource_info)

            # Create session and fetch pages
            session = await create_confluence_session(
                CONFLUENCE_URL,
                CONFLUENCE_USERNAME,
                CONFLUENCE_TOKEN,
                CONFLUENCE_SSL_VERIFY,
            )

            try:
                pages = await fetch_space_pages_http(
                    session,
                    CONFLUENCE_URL,
                    space_key,
                    page_ids,  # Pass page_ids so it only reloads those specific pages
                )

                if not pages:
                    logger.warning(f"No pages found in {space_key}")
                    return

                # Create reload job with total
                job_response = await client.create_job(
                    datasource_id=datasource_info.datasource_id,
                    job_status=JobStatus.IN_PROGRESS,
                    message=f"Reloading {len(pages)} pages from {space_key}",
                    total=len(pages),
                )
                job_id = job_response["job_id"]

                # Ingest pages
                async with ConfluenceLoader(
                    rag_client=client,
                    job_manager=job_manager,
                    datasource_info=datasource_info,
                    confluence_url=CONFLUENCE_URL,
                    username=CONFLUENCE_USERNAME,
                    token=CONFLUENCE_TOKEN,
                    verify_ssl=CONFLUENCE_SSL_VERIFY,
                    max_concurrency=MAX_CONCURRENCY,
                ) as loader:
                    await loader.ingest_pages(pages, job_id)

            finally:
                await session.close()

        except Exception as e:
            logger.error(f"Error reloading {datasource_info.datasource_id}: {e}")
            logger.error(traceback.format_exc())
            await job_manager.add_error_msg(job_id, str(e))
            raise

    except Exception as e:
        logger.error(f"Error in reload_datasource: {e}")
        logger.error(traceback.format_exc())


async def periodic_reload(client: Client):
    """Periodically reload all configured Confluence spaces."""
    logger.info("Starting periodic Confluence reload...")
    job_manager = JobManager(redis_client)

    try:
        # First, process any configured spaces from CONFLUENCE_SPACES env var
        if CONFLUENCE_SPACES:
            logger.info(
                f"Processing configured spaces from CONFLUENCE_SPACES: {CONFLUENCE_SPACES}"
            )
            spaces_config = parse_confluence_spaces(CONFLUENCE_SPACES)

            # Create session
            session = await create_confluence_session(
                CONFLUENCE_URL,
                CONFLUENCE_USERNAME,
                CONFLUENCE_TOKEN,
                CONFLUENCE_SSL_VERIFY,
            )

            try:
                # Process each configured space
                for space_key, page_ids in spaces_config.items():
                    try:
                        # Generate datasource ID
                        datasource_id = generate_datasource_id(
                            CONFLUENCE_URL, space_key
                        )

                        # Fetch or create datasource
                        datasources = await client.list_datasources(
                            ingestor_id=client.ingestor_id
                        )
                        datasource_info = next(
                            (
                                ds
                                for ds in datasources
                                if ds.datasource_id == datasource_id
                            ),
                            None,
                        )

                        if not datasource_info:
                            # Create datasource
                            logger.info(
                                f"Creating datasource for configured space: {datasource_id}"
                            )
                            datasource_info = _create_datasource_info(
                                datasource_id=datasource_id,
                                ingestor_id=client.ingestor_id,
                                space_key=space_key,
                                description=f"Auto-synced Confluence space {space_key}",
                                page_ids=page_ids,
                            )
                            await client.upsert_datasource(datasource_info)

                        # Fetch pages
                        pages = await fetch_space_pages_http(
                            session, CONFLUENCE_URL, space_key, page_ids
                        )

                        if not pages:
                            logger.info(
                                f"No pages found in configured space {space_key}"
                            )
                            continue

                        logger.info(
                            f"Auto-syncing {len(pages)} pages from configured space {space_key}"
                        )

                        # Create job with total
                        job_response = await client.create_job(
                            datasource_id=datasource_id,
                            job_status=JobStatus.IN_PROGRESS,
                            message=f"Auto-syncing {len(pages)} pages from {space_key}",
                            total=len(pages),
                        )
                        job_id = job_response["job_id"]

                        # Ingest pages
                        async with ConfluenceLoader(
                            rag_client=client,
                            job_manager=job_manager,
                            datasource_info=datasource_info,
                            confluence_url=CONFLUENCE_URL,
                            username=CONFLUENCE_USERNAME,
                            token=CONFLUENCE_TOKEN,
                            verify_ssl=CONFLUENCE_SSL_VERIFY,
                            max_concurrency=MAX_CONCURRENCY,
                        ) as loader:
                            await loader.ingest_pages(pages, job_id)

                        # Update datasource last_updated
                        datasource_info.last_updated = int(time.time())
                        await client.upsert_datasource(datasource_info)

                        logger.info(f"Completed auto-sync for space {space_key}")

                    except Exception as e:
                        logger.error(f"Error auto-syncing space {space_key}: {e}")
                        logger.error(traceback.format_exc())

            finally:
                await session.close()

        # Then reload any existing datasources that haven't been updated recently
        # (skip ones we just synced from CONFLUENCE_SPACES)
        datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
        current_time = int(time.time())

        datasources_to_reload = [
            ds
            for ds in datasources
            if (current_time - ds.last_updated) > RELOAD_RECENT_THRESHOLD
        ]

        logger.info(
            f"Found {len(datasources)} total datasources, {len(datasources_to_reload)} need reload"
        )

        for datasource_info in datasources_to_reload:
            try:
                await reload_datasource(client, job_manager, datasource_info)
            except Exception as e:
                logger.error(f"Error reloading {datasource_info.datasource_id}: {e}")

        logger.info("Periodic reload completed")

    except Exception as e:
        logger.error(f"Error in periodic reload: {e}")
        logger.error(traceback.format_exc())


async def redis_listener(client: Client):
    """Listen for Confluence ingest requests on Redis queue.

    Manages concurrent page ingestion tasks following webloader pattern.
    """
    job_manager = JobManager(redis_client)
    active_tasks: Set[asyncio.Task] = set()

    logger.info(f"Starting Redis listener on queue: {CONFLUENCE_INGESTOR_REDIS_QUEUE}")
    logger.info(f"Max concurrent tasks: {MAX_INGESTION_TASKS}")

    async def handle_task(coro, task_name: str):
        """Wrapper for task error handling."""
        try:
            await coro
        except Exception as e:
            logger.error(f"Error in {task_name}: {e}")
            logger.error(traceback.format_exc())

    try:
        while True:
            try:
                # Clean completed tasks
                done_tasks = {task for task in active_tasks if task.done()}
                for task in done_tasks:
                    try:
                        task.result()
                    except Exception as e:
                        logger.error(f"Task failed: {e}")
                        logger.error(traceback.format_exc())
                active_tasks -= done_tasks

                # Check capacity
                if len(active_tasks) >= MAX_INGESTION_TASKS:
                    await asyncio.sleep(0.5)
                    continue

                # Pop from Redis (blocking with 1s timeout)
                result = await redis_client.blpop(
                    [CONFLUENCE_INGESTOR_REDIS_QUEUE], timeout=1
                )

                if result is None:
                    continue

                _, message = result

                try:
                    ingestor_request = IngestorRequest.model_validate_json(message)

                    if ingestor_request.ingestor_id != client.ingestor_id:
                        continue

                    # Handle INGEST_PAGE command
                    if (
                        ingestor_request.command
                        == ConfluenceIngestorCommand.INGEST_PAGE
                    ):
                        ingest_request = ConfluenceIngestRequest.model_validate(
                            ingestor_request.payload
                        )

                        task = asyncio.create_task(
                            handle_task(
                                process_page_ingestion(
                                    client, job_manager, ingest_request
                                ),
                                f"Page ingestion: {ingest_request.url}",
                            )
                        )
                        active_tasks.add(task)

                    # Handle RELOAD_ALL command
                    elif (
                        ingestor_request.command == ConfluenceIngestorCommand.RELOAD_ALL
                    ):
                        task = asyncio.create_task(
                            handle_task(
                                periodic_reload(client), "Reload all datasources"
                            )
                        )
                        active_tasks.add(task)

                    # Handle RELOAD_DATASOURCE command
                    elif (
                        ingestor_request.command
                        == ConfluenceIngestorCommand.RELOAD_DATASOURCE
                    ):
                        reload_request = ConfluenceReloadRequest.model_validate(
                            ingestor_request.payload
                        )

                        # Fetch datasource info
                        datasources = await client.list_datasources(
                            ingestor_id=client.ingestor_id
                        )
                        datasource_info = next(
                            (
                                ds
                                for ds in datasources
                                if ds.datasource_id == reload_request.datasource_id
                            ),
                            None,
                        )

                        if datasource_info:
                            task = asyncio.create_task(
                                handle_task(
                                    reload_datasource(
                                        client, job_manager, datasource_info
                                    ),
                                    f"Reload datasource: {reload_request.datasource_id}",
                                )
                            )
                            active_tasks.add(task)
                        else:
                            logger.warning(
                                f"Datasource not found: {reload_request.datasource_id}"
                            )

                except Exception as e:
                    logger.error(f"Error processing message: {e}")
                    logger.error(traceback.format_exc())

            except asyncio.CancelledError:
                logger.info("Redis listener cancelled, waiting for tasks...")
                if active_tasks:
                    await asyncio.gather(*active_tasks, return_exceptions=True)
                break
            except Exception as e:
                logger.error(f"Listener loop error: {e}")
                logger.error(traceback.format_exc())
                await asyncio.sleep(5)

    finally:
        if active_tasks:
            for task in active_tasks:
                task.cancel()
            await asyncio.gather(*active_tasks, return_exceptions=True)

        await redis_client.close()


if __name__ == "__main__":
    try:
        logger.info("Starting Confluence Ingestor...")
        logger.info(f"Confluence URL: {CONFLUENCE_URL}")
        logger.info(f"Configured spaces: {CONFLUENCE_SPACES or '(none)'}")
        logger.info(f"Reload interval: {RELOAD_INTERVAL}s")

        # Build and run the ingestor (same pattern as webloader)
        IngestorBuilder().name(CONFLUENCE_INGESTOR_NAME).type(
            CONFLUENCE_INGESTOR_TYPE
        ).description(f"Confluence wiki page ingestor for {CONFLUENCE_URL}").metadata(
            {"confluence_url": CONFLUENCE_URL, "reload_interval": RELOAD_INTERVAL}
        ).sync_with_fn(
            periodic_reload
        ).with_startup(
            redis_listener
        ).every(
            RELOAD_INTERVAL
        ).run()

    except KeyboardInterrupt:
        logger.info("Confluence ingestor interrupted by user")
    except Exception as e:
        logger.error(f"Confluence ingestor failed: {e}", exc_info=True)
        raise
