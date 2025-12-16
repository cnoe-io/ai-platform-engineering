import os
import asyncio
import time
from typing import List, Optional, Dict, Any, Callable
import aiohttp
from common.models.rag import DataSourceInfo, DocumentMetadata
from common.models.server import DocumentIngestRequest, IngestorPingRequest, ExploreDataEntityRequest
from common.job_manager import JobStatus, JobInfo
from common.models.graph import Entity
from langchain_core.documents import Document
import common.utils as utils
import dotenv

# Load environment variables from .env file
dotenv.load_dotenv()

logger = utils.get_logger(__name__)

class Client():
    """
    Client bindings for RAG server REST API - handles ingestor lifecycle and data ingestion
    """
    def __init__(self, ingestor_name: str, ingestor_type: str, ingestor_description: str = "", ingestor_metadata: Optional[Dict[str, Any]] = {}):
        self.server_addr = os.getenv("RAG_SERVER_URL", "http://localhost:9446")
        self.ingestor_type = ingestor_type
        self.ingestor_name = ingestor_name
        self.ingestor_description = ingestor_description
        self.ingestor_metadata = ingestor_metadata
        self.ingestor_id: Optional[str] = None

        # This is what the ingestor will batch ingestion by
        # ingestor will choose whichever is smaller: self.ingestor_max_docs_per_ingest or self.server_max_docs_per_ingest
        self.ingestor_max_docs_per_ingest: int = int(os.getenv("MAX_DOCUMENTS_PER_INGEST", "1000")) 
        self.server_max_docs_per_ingest: int = 1000  # This is the server's max documents per ingestion request - will be updated from server during ping

        self._ping_task: Optional[asyncio.Task] = None
        self._ping_interval = int(os.getenv("INGESTOR_PING_INTERVAL_SECONDS", "120"))  # Default 2 minutes
        
        # Note: Health check will be done during initialize() with aiohttp
    
    async def initialize(self) -> None:
        """
        Initialize the ingestor by performing initial ping and starting periodic ping task
        """
        logger.info(f"Initializing ingestor {self.ingestor_name} of type {self.ingestor_type}")
        
        # Perform initial ping to get ingestor_id with retry
        await utils.retry_function_async(self._perform_ping, retries=10, delay=5)
        
        if self.ingestor_id is None:
            raise ValueError("Failed to get ingestor_id from server during initialization")
        
        # Start periodic ping task
        self._ping_task = asyncio.create_task(self._periodic_ping())
        logger.info(f"Ingestor initialized with ID: {self.ingestor_id}")
    
    def max_docs_per_ingest(self) -> int:
        """
        Return the maximum number of documents the ingestor will ingest per ingestion request
        """
        logger.info(f"ingestor_max_docs_per_ingest: {self.ingestor_max_docs_per_ingest}, server_max_docs_per_ingest: {self.server_max_docs_per_ingest}")
        return min(self.ingestor_max_docs_per_ingest, self.server_max_docs_per_ingest)

    async def shutdown(self) -> None:
        """
        Shutdown the ingestor and stop periodic ping task
        """
        if self._ping_task:
            self._ping_task.cancel()
            try:
                await self._ping_task
            except asyncio.CancelledError:
                pass
            self._ping_task = None
        logger.info(f"Ingestor {self.ingestor_name} shutdown complete")
    
    async def _perform_ping(self) -> Dict[str, Any]:
        """
        Internal method to perform ping and update ingestor_id
        """
        ping_request = IngestorPingRequest(
            ingestor_name=self.ingestor_name,
            ingestor_type=self.ingestor_type,
            description=self.ingestor_description,
            metadata=self.ingestor_metadata
        )
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url=f"{self.server_addr}/v1/ingestor/heartbeat",
                headers={'Content-Type': 'application/json'},
                json=ping_request.model_dump()
            ) as resp:
                resp.raise_for_status()
                
                # Extract response data
                ping_response = await resp.json()
                
                # Extract ingestor_id and server_max_docs_per_ingest from response
                self.ingestor_id = ping_response.get('ingestor_id', f"{self.ingestor_type}:{self.ingestor_name}")
                self.server_max_docs_per_ingest = ping_response.get('max_documents_per_ingest', 1000) # default to 1000 
                
                logger.info(f"Updated max_documents_per_ingest to {self.server_max_docs_per_ingest} for ingestor {self.ingestor_name}")
                
                return ping_response
    
    async def _periodic_ping(self) -> None:
        """
        Periodic ping task that runs in the background
        """
        while True:
            try:
                await asyncio.sleep(self._ping_interval)
                await self._perform_ping()
                logger.debug(f"Periodic ping successful for ingestor {self.ingestor_name}")
            except asyncio.CancelledError:
                logger.info(f"Periodic ping cancelled for ingestor {self.ingestor_name}")
                break
            except Exception as e:
                logger.error(f"Periodic ping failed for ingestor {self.ingestor_name}: {e}")
                # Continue trying even if ping fails
    
    async def ingest_entities(self, job_id: str, datasource_id: str, entities: List[Entity], fresh_until: Optional[int] = None):
        """
        Ingest entities into the RAG system as documents with automatic batching
        :param job_id: ID of the ingestion job
        :param datasource_id: ID of the datasource
        :param entities: List of entities to ingest
        :param fresh_until: Optional fresh until timestamp
        :return: Response from server (last batch response if batching used)
        """
        if self.ingestor_id is None:
            raise ValueError("Ingestor not initialized. Call initialize() first to get ingestor_id.")
        
        if fresh_until is None:
            fresh_until = utils.get_default_fresh_until()
        
        # Convert entities to documents
        documents = []
        for entity in entities:
            # Extract a meaningful title based on entity properties
            title = self._extract_graph_entity_title(entity, entity.get_external_properties())

            document_metadata = DocumentMetadata(
                document_id="",  # Will get populated by server based on entity primary key
                document_type="", # Will get populated by server based on entity type
                datasource_id=datasource_id,
                ingestor_id=self.ingestor_id,
                title=title,
                description=f"Graph entity of type {entity.entity_type}",
                is_graph_entity=True,
                document_ingested_at=None, # Will get populated by server
                fresh_until=fresh_until,
                metadata={}  # Will be populated by server with graph_entity_type and graph_entity_pk
            ).model_dump()

            
            # Use Pydantic's own JSON serialization to preserve all fields including additional_key_properties
            entity_json_text = entity.model_dump_json()

            document = Document(
                page_content=entity_json_text,
                metadata=document_metadata
            )
            documents.append(document)
        
        # Use batching logic by calling ingest_documents
        return await self.ingest_documents(job_id, datasource_id, documents, fresh_until)

    async def ingest_documents(self, job_id: str, datasource_id: str, documents: List[Document], fresh_until: Optional[int] = None):
        """
        Ingest documents into the RAG system with automatic batching
        :param job_id: ID of the ingestion job
        :param datasource_id: ID of the datasource
        :param documents: List of documents to ingest
        :param fresh_until: Optional fresh until timestamp
        :return: Response from server (last batch response if batching used)
        """
        if self.ingestor_id is None:
            raise ValueError("Ingestor not initialized. Call initialize() first to get ingestor_id.")
        
        if fresh_until is None:
            fresh_until = utils.get_default_fresh_until()
        
        logger.info(f"Ingesting {len(documents)} documents with max_docs_per_ingest: {self.max_docs_per_ingest()}")
        # Check if we need to batch the documents
        total_documents = len(documents)
        if total_documents <= self.max_docs_per_ingest():
            # Single batch - process all documents at once
            logger.info(f"Ingesting {total_documents} documents in a single batch")
            return await self._ingest_documents_batch(job_id, datasource_id, documents, fresh_until)
        
        # Multiple batches - split documents into chunks
        logger.info(f"Ingesting {total_documents} documents in batches of {self.max_docs_per_ingest()}")
        last_response: Dict[str, Any] = {}
        
        for i in range(0, total_documents, self.max_docs_per_ingest()):
            batch_end = min(i + self.max_docs_per_ingest(), total_documents)
            batch_documents = documents[i:batch_end]
            batch_num = (i // self.max_docs_per_ingest()) + 1
            total_batches = (total_documents + self.max_docs_per_ingest() - 1) // self.max_docs_per_ingest()
            
            logger.info(f"Processing batch {batch_num}/{total_batches} with {len(batch_documents)} documents")
            last_response = await self._ingest_documents_batch(job_id, datasource_id, batch_documents, fresh_until)
        
        return last_response
    
    def _extract_graph_entity_title(self, entity: Entity, entity_properties: Dict[str, Any]) -> str:
        """
        Extract a meaningful title from entity properties by checking common fields
        :param entity: The entity object
        :param entity_properties: Dictionary of entity properties
        :return: A meaningful title string
        """
        # Common property names that could serve as titles (ordered by preference)
        title_candidates = [
            'name', 'title', 'display_name', 'displayName', 'label', 
            'full_name', 'fullName', 'description', 'summary',
            'subject', 'topic', 'heading', 'caption'
        ]
        
        # First, try to find a title in the entity properties
        for candidate in title_candidates:
            # Check both exact match and case-insensitive match
            for key, value in entity_properties.items():
                if (key.lower() == candidate.lower() and 
                    value and 
                    isinstance(value, str) and 
                    len(value.strip()) > 0):
                    # Clean up the title - limit length and remove extra whitespace
                    title = str(value).strip()
                    if len(title) > 100:  # Reasonable title length limit
                        title = title[:97] + "..."
                    return f"{entity.entity_type}: {title}"
        
        #Fallback: Just the entity type
        return f"Graph Entity {entity.entity_type}"
    
    async def _ingest_documents_batch(self, job_id: str, datasource_id: str, documents: List[Document], fresh_until: int) -> Dict[str, Any]:
        """
        Internal method to ingest a single batch of documents
        :param datasource_id: ID of the datasource
        :param documents: List of documents to ingest (single batch)
        :param fresh_until: Fresh until timestamp
        :return: Response from server
        """
        if self.ingestor_id is None:
            raise ValueError("Ingestor not initialized. Call initialize() first to get ingestor_id.")
        
        # Create DocumentIngestRequest using Pydantic model
        ingest_request = DocumentIngestRequest(
            datasource_id=datasource_id,
            job_id=job_id,
            ingestor_id=self.ingestor_id,
            documents=documents,
            fresh_until=fresh_until
        )
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url=f"{self.server_addr}/v1/ingest",
                headers={'Content-Type': 'application/json'},
                json=ingest_request.model_dump()
            ) as resp:
                resp.raise_for_status()
                return await resp.json()
    

    async def list_datasources(self, ingestor_id: Optional[str] = None) -> List[DataSourceInfo]:
        """
        List datasources from the RAG server
        :param ingestor_id: Optional ingestor ID to filter datasources
        :return: List of DataSourceInfo
        """
        params = {}
        if ingestor_id:
            params["ingestor_id"] = ingestor_id
        
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url=f"{self.server_addr}/v1/datasources",
                headers={'Content-Type': 'application/json'},
                params=params
            ) as resp:
                resp.raise_for_status()
                resp_json = await resp.json()
                datasources_data = resp_json.get("datasources", [])
                return [DataSourceInfo.model_validate(ds) for ds in datasources_data]

    async def upsert_datasource(self, datasource_info: DataSourceInfo):
        """
        Create or update a datasource
        :param datasource_info: Datasource information
        """
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url=f"{self.server_addr}/v1/datasource",
                headers={'Content-Type': 'application/json'},
                json=datasource_info.model_dump()
            ) as resp:
                resp.raise_for_status()

    async def create_job(self, datasource_id: str, job_status: Optional[JobStatus] = None, 
                   message: Optional[str] = None, total: Optional[int] = None) -> Dict[str, Any]:
        """
        Create a new job for a datasource
        :param datasource_id: ID of the datasource
        :param job_status: Status of the job
        :param message: Job message
        :param total: Total number of items to process
        :return: Job creation response with job_id and datasource_id
        """
        params = {"datasource_id": datasource_id}
        if job_status is not None:
            params["job_status"] = job_status.value
        if message is not None:
            params["message"] = message
        if total is not None:
            params["total"] = str(total)  # Convert to string for query params
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url=f"{self.server_addr}/v1/job",
                headers={'Content-Type': 'application/json'},
                params=params
            ) as resp:
                resp.raise_for_status()
                return await resp.json()
    
    async def update_job(self, job_id: str, job_status: Optional[JobStatus] = None, 
                   message: Optional[str] = None, total: Optional[int] = None) -> Dict[str, Any]:
        """
        Update an existing job
        :param job_id: ID of the job to update
        :param job_status: Status of the job
        :param message: Job message
        :param total: Total number of items to process
        :return: Job update response with job_id and datasource_id
        """
        params = {}
        if job_status is not None:
            params["job_status"] = job_status.value
        if message is not None:
            params["message"] = message
        if total is not None:
            params["total"] = str(total)  # Convert to string for query params
        
        async with aiohttp.ClientSession() as session:
            async with session.patch(
                url=f"{self.server_addr}/v1/job/{job_id}",
                headers={'Content-Type': 'application/json'},
                params=params
            ) as resp:
                resp.raise_for_status()
                return await resp.json()
    
    async def get_job(self, job_id: str) -> JobInfo:
        """
        Get job details by job ID
        :param job_id: Job ID
        :return: Job details
        """
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url=f"{self.server_addr}/v1/job/{job_id}",
                headers={'Content-Type': 'application/json'}
            ) as resp:
                resp.raise_for_status()
                job_data = await resp.json()
                return JobInfo.model_validate(job_data)

    async def increment_job_progress(self, job_id: str, increment: int = 1) -> Dict[str, Any]:
        """
        Increment job progress counter
        :param job_id: Job ID
        :param increment: Amount to increment by
        :return: Updated progress information
        """
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url=f"{self.server_addr}/v1/job/{job_id}/increment-progress",
                headers={'Content-Type': 'application/json'},
                params={"increment": increment}
            ) as resp:
                resp.raise_for_status()
                return await resp.json()

    async def increment_job_failure(self, job_id: str, increment: int = 1) -> Dict[str, Any]:
        """
        Increment job failure counter
        :param job_id: Job ID
        :param increment: Amount to increment by
        :return: Updated failure information
        """
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url=f"{self.server_addr}/v1/job/{job_id}/increment-failure",
                headers={'Content-Type': 'application/json'},
                params={"increment": increment}
            ) as resp:
                resp.raise_for_status()
                return await resp.json()

    async def add_job_error(self, job_id: str, error_messages: List[str]) -> Dict[str, Any]:
        """
        Add error messages to a job
        :param job_id: Job ID
        :param error_messages: List of error messages to add
        :return: Error addition response
        """
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url=f"{self.server_addr}/v1/job/{job_id}/add-errors",
                headers={'Content-Type': 'application/json'},
                json=error_messages
            ) as resp:
                resp.raise_for_status()
                return await resp.json()

    async def is_job_terminated(self, job_id: str) -> bool:
        """
        Check if a job is in a terminated state (COMPLETED or FAILED)
        :param job_id: Job ID
        :return: True if job is terminated, False otherwise
        """
        job_info = await self.get_job(job_id)
        return job_info.status == JobStatus.TERMINATED

    async def graph_find_entity(self, entity_type: str, entity_pk: str) -> Dict[str, Any]:
        """
        Find a graph entity by type and primary key
        :param entity_type: Type of the entity
        :param entity_pk: Primary key of the entity
        :return: Entity and relations information
        """
        explore_request = ExploreDataEntityRequest(
            entity_type=entity_type,
            entity_pk=entity_pk
        )
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url=f"{self.server_addr}/v1/graph/explore/data/entity",
                headers={'Content-Type': 'application/json'},
                json=explore_request.model_dump()
            ) as resp:
                resp.raise_for_status()
                return await resp.json()

class IngestorBuilder:
    """
    Builder pattern for creating and running ingestors with minimal boilerplate
    
    Example usage:
        def my_sync_function(client):
            # Create datasource
            datasource = DataSourceInfo(
                datasource_id="my-datasource",
                ingestor_id=client.ingestor_id or "",
                description="Sample data",
                source_type="documents",
                last_updated=int(time.time())
            )
            client.upsert_datasource(datasource)
            
            # Ingest entities
            entities = [Entity(entity_id="1", entity_type="Document", properties={"title": "Test"})]
            client.ingest_entities("my-datasource", entities)
        
        # Run ingestor
        ingestor_builder()\\
            .name("my-ingestor")\\
            .type("test")\\
            .sync_with(my_sync_function)\\
            .every(60)\\
            .run()
    """
    
    def __init__(self):
        self._name: Optional[str] = None
        self._type: Optional[str] = None
        self._description: Optional[str] = None
        self._metadata: Dict[str, Any] = {}
        self._sync_function: Optional[Callable] = None
        self._startup_function: Optional[Callable] = None
        self._sync_interval = 0  # User-specified sync interval (how often data should be refreshed)
        self._init_delay = 0  # Optional init delay
    
    def name(self, name: str) -> 'IngestorBuilder':
        """Set the ingestor name"""
        self._name = name
        return self
    
    def type(self, ingestor_type: str) -> 'IngestorBuilder':
        """Set the ingestor type"""
        self._type = ingestor_type
        return self
    
    def description(self, description: str) -> 'IngestorBuilder':
        """Set the ingestor description"""
        self._description = description
        return self
    
    def metadata(self, metadata: Dict[str, Any]) -> 'IngestorBuilder':
        """Set the ingestor metadata"""
        self._metadata = metadata
        return self
    
    def sync_with_fn(self, sync_function) -> 'IngestorBuilder':
        """Set the sync function to run periodically. Can be sync or async."""
        self._sync_function = sync_function
        return self
    
    def every(self, seconds: int) -> 'IngestorBuilder':
        """
        Set the sync interval in seconds (how often data should be refreshed).
        
        The builder will automatically check datasources and determine when the next
        sync should occur based on their last_updated timestamps.
        """
        self._sync_interval = seconds
        return self
    
    def with_init_delay(self, seconds: int) -> 'IngestorBuilder':
        """Set an optional initialization delay in seconds before starting sync"""
        self._init_delay = seconds
        return self
    
    def with_startup(self, startup_function: Callable) -> 'IngestorBuilder':
        """Set an optional startup function to run concurrently (e.g., to start a server). Can be sync or async."""
        self._startup_function = startup_function
        return self
    
    def run(self):
        """Build and run the ingestor"""
        # Validate required parameters
        assert self._name, "Ingestor name is required. Use .name('my-ingestor')"
        assert self._type, "Ingestor type is required. Use .type('my-type')"
        assert self._sync_function, "Sync function is required. Use .sync_with(my_function)"

        if self._description is None:
            self._description = f"Ingestor {self._name} of type {self._type}"
        
        if self._metadata is None:
            self._metadata = {}
        
        # Run the ingestor
        asyncio.run(self._run_ingestor())
    
    async def _calculate_next_sync_time(self, client: Client) -> int:
        """
        Calculate how long to sleep before next sync by checking datasource timestamps.
        Returns number of seconds to sleep.
        """
        try:
            current_time = int(time.time())
            
            # Fetch all datasources for this ingestor
            datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
            
            if not datasources:
                # No datasources yet - use sync_interval to avoid tight loop
                # The sync function should create datasources if needed
                logger.debug(f"No datasources found, will check again in 30 seconds")
                return 30  # 30 seconds
            
            # Find the earliest datasource that will need reloading
            min_time_until_reload = self._sync_interval
            
            for ds in datasources:
                if ds.last_updated is None:
                    # Datasource never updated, needs immediate reload
                    logger.debug(f"Datasource {ds.datasource_id} has no last_updated, needs immediate sync")
                    return 0
                
                time_since_update = current_time - ds.last_updated
                time_until_reload = self._sync_interval - time_since_update
                
                if time_until_reload <= 0:
                    # This datasource is overdue, sync immediately
                    logger.debug(f"Datasource {ds.datasource_id} is overdue (last updated {time_since_update}s ago), needs immediate sync")
                    return 0
                
                # Track the earliest reload time
                if time_until_reload < min_time_until_reload:
                    min_time_until_reload = time_until_reload
                    logger.debug(f"Datasource {ds.datasource_id} will need reload in {time_until_reload}s")
            
            # Add a small minimum to avoid too-frequent checks (e.g., 1 minute)
            MIN_SLEEP_TIME = 60  # 1 minute minimum
            sleep_time = max(MIN_SLEEP_TIME, int(min_time_until_reload))
            
            logger.info(f"Next sync in {sleep_time}s ({sleep_time/3600:.1f}h) based on datasource schedules")
            return sleep_time
            
        except Exception as e:
            # If we can't calculate, fall back to sync interval
            logger.warning(f"Error calculating next sync time: {e}, using full sync_interval")
            return self._sync_interval
    
    async def _run_ingestor(self):
        """Internal method to run the ingestor with proper async handling"""
        # Type checking - these should never be None due to assertions in run()
        assert self._name is not None
        assert self._type is not None
        assert self._sync_function is not None
        assert self._description is not None
        assert self._metadata is not None
        
        # Check if we should exit after first sync (for debugging and job mode)
        exit_after_first_sync = os.getenv("EXIT_AFTER_FIRST_SYNC", "false").lower() in ("true", "1", "yes")
        
        # If exit_after_first_sync is set, force single-run mode
        # if exit_after_first_sync:
        #     self._sync_interval = 0
        #     logger.info("EXIT_AFTER_FIRST_SYNC is set, forcing single-run mode")
        
        logger.info(f"Starting ingestor: {self._name} (type: {self._type}, sync_interval: {self._sync_interval}s, init_delay: {self._init_delay}s, exit_after_first_sync: {exit_after_first_sync})")
        
        # Create and initialize RAG client
        client = Client(self._name, self._type, self._description, self._metadata)
        
        try:
            # Initialize client
            await client.initialize()
            logger.info(f"RAG client initialized: {self._name} ({self._type})")
            
            # Optional initialization delay
            if self._init_delay > 0:
                logger.info(f"Waiting {self._init_delay} seconds before starting sync...")
                await asyncio.sleep(self._init_delay)
            
            # Start optional startup function concurrently (e.g., server)
            startup_task = None
            if self._startup_function:
                logger.info("Starting user-provided startup function...")
                if asyncio.iscoroutinefunction(self._startup_function):
                    startup_task = asyncio.create_task(self._startup_function(client))
                else:
                    # Run sync function in executor to avoid blocking
                    assert self._startup_function is not None  # Type hint for mypy
                    startup_fn = self._startup_function
                    async def _run_sync_startup():
                        loop = asyncio.get_event_loop()
                        await loop.run_in_executor(None, startup_fn, client)
                    startup_task = asyncio.create_task(_run_sync_startup())
                logger.info("Startup function running concurrently")
            
            if self._sync_interval <= 0:
                # Single run mode
                logger.info("Running single sync cycle...")
                
                # Call user's sync function with client (original signature)
                if asyncio.iscoroutinefunction(self._sync_function):
                    await self._sync_function(client)
                else:
                    self._sync_function(client)
                
                logger.info("Single sync cycle completed.")
                return
            else:
                # Periodic mode with smart scheduling based on datasource timestamps
                while True:
                    # Calculate when next sync should happen based on datasource timestamps
                    sleep_time = await self._calculate_next_sync_time(client)
                    
                    if sleep_time > 0:
                        # If exit_after_first_sync is set, exit after first sync
                        if exit_after_first_sync:
                            logger.info("EXIT_AFTER_FIRST_SYNC is set. Exiting as there are no datasources to sync.")
                            return
                        
                        # No datasources need syncing yet, sleep until next one is due
                        await asyncio.sleep(sleep_time)
                    
                    # Now run the sync (either immediately if overdue, or after sleeping)
                    logger.info("Running sync cycle...")
                    
                    # Call user's sync function (original signature - no changes needed!)
                    if asyncio.iscoroutinefunction(self._sync_function):
                        await self._sync_function(client)
                    else:
                        self._sync_function(client)
                    
                    logger.info("Sync cycle completed.")

                    # Exit after first sync if environment variable is set
                    if exit_after_first_sync:
                        logger.info("EXIT_AFTER_FIRST_SYNC is set. Exiting after first sync.")
                        return
                    
        except KeyboardInterrupt:
            logger.info("Received interrupt signal, shutting down...")
        except Exception as e:
            logger.error(f"Ingestor error: {e}", exc_info=True)
            raise
        finally:
            # Cancel startup task if it's still running
            if startup_task and not startup_task.done():
                logger.info("Cancelling startup task...")
                startup_task.cancel()
                try:
                    await startup_task
                except asyncio.CancelledError:
                    pass
            
            # Cleanup
            await client.shutdown()
            logger.info("Ingestor shutdown complete")
