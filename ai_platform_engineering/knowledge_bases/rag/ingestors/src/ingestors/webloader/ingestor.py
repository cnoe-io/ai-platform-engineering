import os
import asyncio
import time
import traceback
from typing import Set
from redis.asyncio import Redis
from common.ingestor import IngestorBuilder, Client
from common.models.rag import DataSourceInfo
from common.models.server import IngestorRequest, UrlIngestRequest, WebIngestorCommand, UrlReloadRequest
from common.job_manager import JobStatus, JobManager
from common.constants import WEBLOADER_INGESTOR_REDIS_QUEUE, WEBLOADER_INGESTOR_NAME, WEBLOADER_INGESTOR_TYPE
from common.utils import get_logger, generate_datasource_id_from_url
from loader.loader import Loader

logger = get_logger(__name__)

# Redis configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


# Webloader configuration
MAX_CONCURRENCY = int(os.getenv("WEBLOADER_MAX_CONCURRENCY", "10"))
RELOAD_INTERVAL = int(os.getenv("WEBLOADER_RELOAD_INTERVAL", "86400"))  # 24 hours default
MAX_INGESTION_TASKS = int(os.getenv("WEBLOADER_MAX_INGESTION_TASKS", "5"))  # Max concurrent ingestion tasks

redis_client = Redis.from_url(REDIS_URL, decode_responses=True)


async def process_url_ingestion(
    client: Client,
    job_manager: JobManager,
    url_request: UrlIngestRequest
):
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
        
        # Fetch existing job for this datasource (created by server)
        jobs = await job_manager.get_jobs_by_datasource(datasource_id)
        if not jobs:
            logger.error(f"No job found for datasource: {datasource_id}")
            raise ValueError(f"No job found for datasource: {datasource_id}")
        
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
            message=f"Starting URL ingestion for {url_request.url}"
        )
        logger.info(f"Processing job: {job_id} for datasource: {datasource_id}")
        
        # Process the URL using Loader
        async with Loader(
            rag_client=client,
            jobmanager=job_manager,
            datasourceinfo=datasource_info,
            max_concurrency=MAX_CONCURRENCY
        ) as loader:
            await loader.load_url(
                url=url_request.url,
                job_id=job_id,
                check_for_site_map=url_request.check_for_sitemaps,
                sitemap_max_urls=url_request.sitemap_max_urls
            )
        
        logger.info(f"Completed URL ingestion for {url_request.url}")
        
    except Exception as e:
        error_msg = f"Error processing URL {url_request.url}: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        
        # Try to update job with error if we have job_id
        try:
            if 'job_id' in locals():
                await job_manager.add_error_msg(job_id, error_msg)
        except Exception:
            pass
        
        raise


async def reload_datasource(
    client: Client,
    job_manager: JobManager,
    datasource_info: DataSourceInfo):
    """Reload a single datasource."""
    # Extract UrlIngestRequest from metadata
    if not datasource_info.metadata:
        logger.warning(f"No metadata for datasource {datasource_info.datasource_id}, skipping")
        return
    url_ingest_request_data = datasource_info.metadata.get("url_ingest_request")
    if not url_ingest_request_data:
        logger.warning(f"No url_ingest_request in metadata for {datasource_info.datasource_id}, skipping")
        return
    
    # Parse the UrlIngestRequest model
    url_request = UrlIngestRequest.model_validate(url_ingest_request_data)
    
    logger.info(f"Reloading datasource: {datasource_info.datasource_id}")
    
    # Create new job for reload
    job_response = await client.create_job(
        datasource_id=datasource_info.datasource_id,
        job_status=JobStatus.IN_PROGRESS,
        message=f"Reloading data from {url_request.url}"
    )
    job_id = job_response["job_id"]
    logger.info(f"Created reload job: {job_id}")
    
    try:
        # Update datasource last_updated timestamp (no need to update job_id)
        datasource_info.last_updated = int(time.time())
        await client.upsert_datasource(datasource_info)
        
        # Process the URL using Loader (which will delete old data via fresh_until)
        async with Loader(
            rag_client=client,
            jobmanager=job_manager,
            datasourceinfo=datasource_info,
            max_concurrency=MAX_CONCURRENCY
        ) as loader:
            await loader.load_url(
                url=url_request.url,
                job_id=job_id,
                check_for_site_map=url_request.check_for_sitemaps,
                sitemap_max_urls=url_request.sitemap_max_urls
            )
        
        logger.info(f"Completed reload for {datasource_info.datasource_id}")
        
    except Exception as e:
        error_msg = f"Error reloading datasource {datasource_info.datasource_id}: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        
        await job_manager.add_error_msg(job_id, error_msg)
        
        raise


async def redis_listener(client: Client):
    """
    Listen to Redis queue for new URL ingestion requests.
    Processes IngestorRequest messages with UrlIngestRequest payloads.
    Manages concurrent ingestion tasks with a semaphore.
    """

    # Since this will be run in a trusted environment, we can use redis_client instead of server apis for job management
    job_manager = JobManager(redis_client)
    
    # Track active ingestion tasks
    active_tasks: Set[asyncio.Task] = set()
    
    logger.info(f"Starting Redis listener on {REDIS_URL} queue: {WEBLOADER_INGESTOR_REDIS_QUEUE}")
    logger.info(f"Max concurrent ingestion tasks: {MAX_INGESTION_TASKS}")
    
    async def handle_ingestion_task(coro, task_name: str):
        """Wrapper to handle task completion and cleanup."""
        try:
            await coro
        except Exception as e:
            logger.error(f"Error in {task_name}: {e}")
            logger.error(traceback.format_exc())
    
    try:
        while True:
            try:
                # Clean up completed tasks
                done_tasks = {task for task in active_tasks if task.done()}
                for task in done_tasks:
                    try:
                        task.result()  # Raise any exceptions that occurred
                    except Exception as e:
                        logger.error(f"Task failed: {e}")
                active_tasks -= done_tasks
                
                # Check if we can accept more tasks
                if len(active_tasks) >= MAX_INGESTION_TASKS:
                    logger.debug(f"At max capacity ({MAX_INGESTION_TASKS} tasks), waiting for tasks to complete...")
                    # Wait a bit before checking again
                    await asyncio.sleep(0.5)
                    continue
                
                # Blocking pop from Redis list (timeout 1 second to allow for task cleanup)
                result = await redis_client.blpop([WEBLOADER_INGESTOR_REDIS_QUEUE], timeout=1)  # type: ignore
                
                if result is None:
                    # Timeout - continue loop to check for shutdown and cleanup tasks
                    continue
                
                _, message = result
                logger.info(f"Received message from Redis: {message}")
                
                # Parse the IngestorRequest
                try:
                    ingestor_request = IngestorRequest.model_validate_json(message)
                    
                    # Verify this request is for our ingestor
                    if ingestor_request.ingestor_id != client.ingestor_id:
                        logger.warning(f"Ignoring request for different ingestor: {ingestor_request.ingestor_id}")
                        continue
                    
                    # Handle different commands
                    if ingestor_request.command == WebIngestorCommand.INGEST_URL:
                        url_request = UrlIngestRequest.model_validate(ingestor_request.payload)
                        logger.info(f"Processing URL ingestion request: {url_request.url} (active tasks: {len(active_tasks)})")
                        
                        # Create task for concurrent processing
                        task = asyncio.create_task(
                            handle_ingestion_task(
                                process_url_ingestion(
                                    client=client,
                                    job_manager=job_manager,
                                    url_request=url_request
                                ),
                                f"URL ingestion: {url_request.url}"
                            )
                        )
                        active_tasks.add(task)
                        
                    elif ingestor_request.command == WebIngestorCommand.RELOAD_ALL:
                        logger.info("Processing on-demand reload request")
                        
                        # Create task for concurrent processing
                        task = asyncio.create_task(
                            handle_ingestion_task(
                                periodic_reload(client),
                                "Reload all datasources"
                            )
                        )
                        active_tasks.add(task)
                        
                    elif ingestor_request.command == WebIngestorCommand.RELOAD_DATASOURCE:
                        # Reload specific datasource
                        if not ingestor_request.payload:
                            logger.error("Missing payload in reload-datasource request")
                            continue
                        
                        datasource_id = UrlReloadRequest.model_validate(ingestor_request.payload).datasource_id
                        if not datasource_id:
                            logger.error("Missing datasource_id in reload-datasource request")
                            continue
                        
                        logger.info(f"Processing reload request for datasource: {datasource_id}")
                        
                        # Fetch the specific datasource
                        datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
                        datasource_info = next((ds for ds in datasources if ds.datasource_id == datasource_id), None)
                        
                        if not datasource_info:
                            logger.error(f"Datasource not found: {datasource_id}")
                            continue
                        
                        # Create task for concurrent processing
                        task = asyncio.create_task(
                            handle_ingestion_task(
                                reload_datasource(client, job_manager, datasource_info),
                                f"Reload datasource: {datasource_id}"
                            )
                        )
                        active_tasks.add(task)
                    
                    else:
                        logger.warning(f"Unknown command: {ingestor_request.command}")
                    
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
                    logger.error(traceback.format_exc())
                    
            except asyncio.CancelledError:
                logger.info("Redis listener cancelled, waiting for active tasks to complete...")
                # Wait for all active tasks to complete
                if active_tasks:
                    logger.info(f"Waiting for {len(active_tasks)} active tasks to complete...")
                    await asyncio.gather(*active_tasks, return_exceptions=True)
                break
            except Exception as e:
                logger.error(f"Error in Redis listener loop: {e}")
                logger.error(traceback.format_exc())
                await asyncio.sleep(5)  # Back off on errors
                
    finally:
        # Cancel any remaining tasks
        if active_tasks:
            logger.info(f"Cancelling {len(active_tasks)} remaining tasks...")
            for task in active_tasks:
                task.cancel()
            await asyncio.gather(*active_tasks, return_exceptions=True)
        
        await redis_client.close()
        logger.info("Redis listener stopped")


async def periodic_reload(client: Client):
    """
    Reload all datasources for this ingestor.
    Fetches datasources filtered by ingestor_id and re-ingests them.
    Called periodically by IngestorBuilder or on-demand via Redis.
    """
    logger.info("Starting datasource reload...")
    job_manager = JobManager(redis_client)
    
    try:
        datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
        logger.info(f"Found {len(datasources)} datasources to reload")
        
        for datasource_info in datasources:
            try:
                await reload_datasource(client, job_manager, datasource_info)
            except Exception as e:
                logger.error(f"Error reloading datasource {datasource_info.datasource_id}: {e}")
                logger.error(traceback.format_exc())
        
        logger.info("Datasource reload completed")
        
    except Exception as e:
        logger.error(f"Error in datasource reload: {e}")
        logger.error(traceback.format_exc())


if __name__ == "__main__":
    try:
        logger.info("Starting Webloader Ingestor...")
        
        # Build and run the ingestor with both Redis listener and periodic reload
        IngestorBuilder()\
            .name(WEBLOADER_INGESTOR_NAME)\
            .type(WEBLOADER_INGESTOR_TYPE)\
            .description("Default ingestor for websites and sitemaps")\
            .metadata({
                "reload_interval": RELOAD_INTERVAL
            })\
            .sync_with_fn(periodic_reload)\
            .with_startup(redis_listener)\
            .every(RELOAD_INTERVAL)\
            .run()
            
    except KeyboardInterrupt:
        logger.info("Webloader ingestor interrupted by user")
    except Exception as e:
        logger.error(f"Webloader ingestor failed: {e}")
        logger.error(traceback.format_exc())
