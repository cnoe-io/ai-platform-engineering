#!/usr/bin/env python3
"""Confluence RAG ingestor - syncs pages from Confluence spaces."""

import os
import asyncio
import time
from typing import Optional, List
from datetime import datetime

import html2text
from atlassian import Confluence
from langchain_core.documents import Document

from common.ingestor import IngestorBuilder, Client
from common.models.rag import DataSourceInfo, DocumentMetadata
from common.models.graph import Entity
from common.job_manager import JobStatus
from common import utils

logger = utils.get_logger(__name__)

# Batch size for ingesting documents to prevent memory issues
INGEST_BATCH_SIZE = 100

# Load configuration at module level for early validation
sync_interval = int(os.environ.get("CONFLUENCE_SYNC_INTERVAL", "3600"))
init_delay = int(os.environ.get("INIT_DELAY_SECONDS", "0"))

confluence_url = os.environ.get("CONFLUENCE_URL")
if not confluence_url:
    raise ValueError("CONFLUENCE_URL environment variable is required")

confluence_username = os.environ.get("CONFLUENCE_USERNAME")
if not confluence_username:
    raise ValueError("CONFLUENCE_USERNAME environment variable is required")

confluence_token = os.environ.get("CONFLUENCE_TOKEN")
if not confluence_token:
    raise ValueError("CONFLUENCE_TOKEN environment variable is required")

confluence_ssl_verify = os.environ.get("CONFLUENCE_SSL_VERIFY", "true").lower() == "true"
ingestor_name = os.environ.get("CONFLUENCE_INGESTOR_NAME", "confluence-main")
confluence_spaces_raw = os.environ.get("CONFLUENCE_SPACES", "")


def parse_space_keys(spaces_raw: str) -> List[str]:
    """Parse CONFLUENCE_SPACES environment variable as a comma-separated list."""
    if not spaces_raw:
        return []

    return [s.strip() for s in spaces_raw.split(",") if s.strip()]


def parse_timestamp(date_str: str) -> Optional[float]:
    """Parse ISO timestamp to Unix timestamp."""
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


class ConfluenceSyncer:
    """Syncs pages from a single Confluence space."""

    def __init__(self, confluence: Confluence, space_key: str):
        self.confluence = confluence
        self.space_key = space_key
        self.html_converter = self._init_html_converter()

    @staticmethod
    def _init_html_converter() -> html2text.HTML2Text:
        """Initialize HTML to text converter."""
        converter = html2text.HTML2Text()
        converter.ignore_links = False
        converter.ignore_images = True
        return converter

    async def _api_call_with_retry(self, api_func, max_retries=5, base_delay=1.0, **kwargs):
        """Make Confluence API calls with exponential backoff retry.

        Wraps synchronous API calls in asyncio.to_thread and retries with exponential backoff.
        """
        api_name = api_func.__name__ if hasattr(api_func, '__name__') else str(api_func)

        for attempt in range(max_retries + 1):
            try:
                return await asyncio.to_thread(api_func, **kwargs)
            except Exception as e:
                error_str = str(e).lower()

                # Check if it's a rate limit or temporary error
                is_retryable = any(keyword in error_str for keyword in [
                    'rate', 'limit', 'timeout', 'temporary', 'unavailable', '429', '503', '504'
                ])

                if is_retryable and attempt < max_retries:
                    wait_time = base_delay * (2 ** attempt)
                    logger.warning(f"{api_name} failed (attempt {attempt + 1}/{max_retries + 1}): {e}. Retrying in {wait_time}s")
                    await asyncio.sleep(wait_time)
                    continue

                # Not retryable or max retries exceeded
                if attempt >= max_retries:
                    logger.error(f"{api_name} failed after {max_retries + 1} attempts")
                raise

        raise RuntimeError(f"Max retries exceeded for {api_name}")

    async def fetch_pages(self, last_ts: Optional[float] = None) -> List[dict]:
        """Fetch pages from Confluence space with pagination and CQL filtering."""
        if not last_ts:
            logger.info(f"Full sync for space {self.space_key}")
            cql = f"space={self.space_key}"
        else:
            # Use CQL to filter server-side for efficiency
            last_date = datetime.fromtimestamp(last_ts).strftime("%Y-%m-%d %H:%M")
            logger.info(f"Incremental sync for {self.space_key} since {last_date}")
            cql = f"space={self.space_key} AND lastModified >= '{last_date}'"

        pages = []
        start = 0
        limit = 100

        while True:
            try:
                # Use CQL for efficient server-side filtering
                response = await self._api_call_with_retry(
                    self.confluence.cql,
                    cql=cql,
                    start=start,
                    limit=limit,
                    expand="content.body.storage,content.version,content.history.lastUpdated,content.space,content.ancestors"
                )

                # Extract content from CQL response
                batch = response.get("results", [])
                if batch:
                    # CQL returns content nested, extract it
                    batch = [item.get("content", item) for item in batch if item.get("content")]

            except (ConnectionError, TimeoutError) as e:
                logger.error(f"Network error fetching pages from {self.space_key}: {e}", exc_info=True)
                break
            except Exception as e:
                logger.error(f"Unexpected error fetching pages from {self.space_key}: {e}", exc_info=True)
                break

            if not batch:
                break

            pages.extend(batch)
            start += len(batch)

            # CQL pagination: if we got fewer results than limit, we're done
            if len(batch) < limit:
                break

        logger.info(f"Fetched {len(pages)} pages from {self.space_key}")
        return pages

    def _page_modified_timestamp(self, page: dict) -> Optional[float]:
        """Get page last modified timestamp from Confluence metadata."""
        history = page.get("history", {})
        last_updated = history.get("lastUpdated", {})
        modified_date = last_updated.get("when")
        if not modified_date:
            return None
        return parse_timestamp(modified_date)

    async def create_document(self, page: dict, datasource_id: str, ingestor_id: str) -> Document:
        """Convert Confluence page to RAG document."""
        page_id = page.get("id")
        if not page_id:
            raise ValueError("Page is missing required 'id' field")
        page_title = page.get("title", "Untitled")
        space = page.get("space", {})
        space_key = space.get("key", self.space_key)
        space_name = space.get("name", space_key)

        # Extract and convert content
        body_html = page.get("body", {}).get("storage", {}).get("value", "")
        content_text = self.html_converter.handle(body_html)
        full_content = f"{page_title}\n\n{content_text}"

        # Extract metadata
        history = page.get("history", {})
        version = page.get("version", {}).get("number", 1)
        created_by = history.get("createdBy", {})
        last_updated = history.get("lastUpdated", {})
        modified_by = last_updated.get("by", {})
        modified_date = last_updated.get("when", datetime.now().isoformat())

        # Build URLs
        page_url = f"{self.confluence.url}/spaces/{space_key}/pages/{page_id}"
        ancestors = [a.get("title", "") for a in page.get("ancestors", [])]

        # Calculate last modified timestamp
        modified_ts = parse_timestamp(modified_date)

        metadata_fields = {
            "source": "confluence",
            "space_key": space_key,
            "space_name": space_name,
            "page_id": page_id,
            "page_url": page_url,
            "author": created_by.get("displayName", "Unknown"),
            "author_id": created_by.get("accountId", ""),
            "created_date": history.get("createdDate", ""),
            "modified_date": modified_date,
            "modified_by": modified_by.get("displayName", "Unknown"),
            "modified_by_id": modified_by.get("accountId", ""),
            "version": version,
            "ancestors": ancestors,
            "type": "confluence_page",
        }
        if modified_ts is not None:
            metadata_fields["last_modified"] = int(modified_ts)

        metadata = DocumentMetadata(
            document_id=f"confluence-page-{space_key}-{page_id}",
            datasource_id=datasource_id,
            ingestor_id=ingestor_id,
            title=page_title,
            document_type="confluence_page",
            document_ingested_at=int(time.time()),
            fresh_until=sync_interval * 3,
            metadata=metadata_fields
        )

        return Document(page_content=full_content, metadata=metadata.model_dump())

    async def create_space_entity(self, space_info: dict) -> Entity:
        """Create graph entity for a space."""
        return Entity(
            entity_type="ConfluenceSpace",
            all_properties={
                "name": space_info.get("name", self.space_key),
                "key": self.space_key,
                "url": f"{self.confluence.url}/spaces/{self.space_key}",
                "description": space_info.get("description", {}).get("plain", {}).get("value", "")
            },
            primary_key_properties=["key"]
        )

    async def create_entities(self, page: dict) -> List[Entity]:
        """Create graph entities for page and users."""
        entities = []
        page_id = page.get("id")
        if not page_id:
            raise ValueError("Page is missing required 'id' field")
        history = page.get("history", {})

        # Page entity
        entities.append(Entity(
            entity_type="ConfluencePage",
            all_properties={
                "title": page.get("title", "Untitled"),
                "url": f"{self.confluence.url}/spaces/{self.space_key}/pages/{page_id}",
                "page_id": page_id,
                "space_key": self.space_key,
                "version": page.get("version", {}).get("number", 1),
                "created": history.get("createdDate", ""),
                "modified": history.get("lastUpdated", {}).get("when", "")
            },
            primary_key_properties=["page_id"]
        ))

        # User entities
        for user_field in ["createdBy", "lastUpdated"]:
            user_data = history.get(user_field, {})
            if user_field == "lastUpdated":
                user_data = user_data.get("by", {})

            account_id = user_data.get("accountId")
            if account_id:
                entities.append(Entity(
                    entity_type="ConfluenceUser",
                    all_properties={
                        "display_name": user_data.get("displayName", "Unknown"),
                        "account_id": account_id,
                        "email": user_data.get("email", "")
                    },
                    primary_key_properties=["account_id"]
                ))

        return entities

    async def sync(self, client: Client, datasource_id: str, last_ts: Optional[float] = None) -> dict:
        """Sync space pages to RAG system."""
        logger.info(f"Processing space: {self.space_key}")

        # Fetch pages
        pages = await self.fetch_pages(last_ts)
        if not pages:
            logger.info(f"No new pages for {self.space_key}")
            return {"status": "success", "pages_synced": 0, "last_ts": None}

        # Get space info
        space_info = await self._api_call_with_retry(
            self.confluence.get_space,
            space_key=self.space_key,
            expand="description"
        )

        # Create job
        job_response = await client.create_job(
            datasource_id=datasource_id,
            job_status=JobStatus.IN_PROGRESS,
            message=f"Ingesting {len(pages)} pages from {self.space_key}",
            total=len(pages)
        )
        job_id = job_response["job_id"]

        try:
            documents = []
            entities = []
            newest_ts = None
            total_ingested = 0

            space_entity = await self.create_space_entity(space_info)
            entities.append(space_entity)

            for i, page in enumerate(pages):
                try:
                    doc = await self.create_document(page, datasource_id, client.ingestor_id)
                    documents.append(doc)

                    page_entities = await self.create_entities(page)
                    entities.extend(page_entities)

                    page_modified_ts = self._page_modified_timestamp(page)
                    if page_modified_ts is not None:
                        if newest_ts is None or page_modified_ts > newest_ts:
                            newest_ts = page_modified_ts

                    # Batch ingest to prevent memory issues
                    if len(documents) >= INGEST_BATCH_SIZE:
                        logger.info(f"Ingesting batch of {len(documents)} documents and {len(entities)} entities")
                        await client.ingest_documents(job_id, datasource_id, documents)
                        await client.ingest_entities(job_id, datasource_id, entities)
                        total_ingested += len(documents)
                        documents.clear()
                        entities.clear()
                        # Keep space entity for next batch
                        entities.append(space_entity)

                    if (i + 1) % 10 == 0:
                        logger.debug(f"Processed {i + 1}/{len(pages)} pages")
                except KeyError as e:
                    logger.error(f"Missing required field in page data: {e}")
                    await client.add_job_error(job_id, [f"Page {page.get('id', 'unknown')}: Missing field {str(e)}"])
                except (ValueError, AttributeError) as e:
                    logger.error(f"Invalid data format in page {page.get('id', 'unknown')}: {e}")
                    await client.add_job_error(job_id, [f"Page {page.get('id', 'unknown')}: Invalid data {str(e)}"])
                except Exception as e:
                    logger.error(f"Unexpected error processing page {page.get('id', 'unknown')}: {e}")
                    await client.add_job_error(job_id, [f"Page {page.get('id', 'unknown')}: {str(e)}"])

            # Ingest remaining documents and entities
            if documents:
                logger.info(f"Ingesting final batch of {len(documents)} documents and {len(entities)} entities")
                await client.ingest_documents(job_id, datasource_id, documents)
                await client.ingest_entities(job_id, datasource_id, entities)
                total_ingested += len(documents)

            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.COMPLETED,
                message=f"Successfully ingested {total_ingested} documents from {self.space_key}"
            )

            logger.info(f"✓ Successfully ingested {total_ingested} documents from {self.space_key}")
            return {"status": "success", "pages_synced": total_ingested, "last_ts": newest_ts}

        except Exception as e:
            logger.error(f"Error ingesting documents for {self.space_key}: {e}")
            await client.add_job_error(job_id, [str(e)])
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.FAILED,
                message=f"Failed to ingest documents: {str(e)}"
            )
            raise


async def sync_confluence_spaces(client: Client):
    """Sync all configured Confluence spaces."""

    # Initialize Confluence client
    confluence = Confluence(
        url=confluence_url,
        username=confluence_username,
        password=confluence_token,
        verify_ssl=confluence_ssl_verify
    )

    # Parse spaces configuration
    space_keys = parse_space_keys(confluence_spaces_raw)
    spaces_config = {key: {"name": key} for key in space_keys}

    # Auto-discover spaces if none configured
    if not spaces_config:
        logger.info("No spaces configured, discovering all accessible spaces")
        try:
            all_spaces = await asyncio.to_thread(
                confluence.get_all_spaces,
                limit=500,
                expand="description"
            )
            spaces_config = {
                space["key"]: {"name": space.get("name", space["key"])}
                for space in all_spaces.get("results", [])
            }
            logger.info(f"Discovered {len(spaces_config)} spaces")
        except Exception as e:
            logger.error(f"Failed to discover spaces: {e}", exc_info=True)
            return

    if not spaces_config:
        logger.warning("No spaces to sync")
        return

    # Load timestamps from previous runs (stored in datasource metadata)
    existing_datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
    timestamp_map = {}
    for ds in existing_datasources:
        if ds.metadata and "last_ts" in ds.metadata:
            space_key = ds.metadata.get("space_key")
            if space_key:
                timestamp_map[space_key] = ds.metadata["last_ts"]

    # Process each space
    for space_key, space_config in spaces_config.items():
        space_name = space_config.get("name", space_key)
        datasource_id = f"confluence-{space_key}"

        logger.info(f"Processing space: {space_name} (key: {space_key})")

        try:
            # Create/update datasource
            last_ts = timestamp_map.get(space_key)

            datasource = DataSourceInfo(
                datasource_id=datasource_id,
                ingestor_id=client.ingestor_id or "",
                description=f"Confluence pages from {space_name}",
                source_type="confluence",
                last_updated=int(time.time()),
                metadata={
                    "space_key": space_key,
                    "space_name": space_name,
                    "last_ts": last_ts or 0
                }
            )
            await client.upsert_datasource(datasource)

            # Sync space
            syncer = ConfluenceSyncer(confluence, space_key)
            result = await syncer.sync(client, datasource_id, last_ts)

            # Update datasource with newest page timestamp
            if result["pages_synced"] > 0 and result["last_ts"] is not None:
                datasource.metadata["last_ts"] = result["last_ts"]
                await client.upsert_datasource(datasource)

        except Exception as e:
            logger.error(f"Failed to sync {space_key}: {e}", exc_info=True)


def main():
    """Main entry point for the Confluence ingestor"""

    # Build and run ingestor
    IngestorBuilder() \
        .name(ingestor_name) \
        .type("confluence") \
        .description(f"Confluence ingestor for {confluence_url}") \
        .metadata({
            "url": confluence_url,
            "sync_interval": sync_interval,
            "init_delay": init_delay
        }) \
        .sync_with_fn(sync_confluence_spaces) \
        .every(sync_interval) \
        .with_init_delay(init_delay) \
        .run()


if __name__ == "__main__":
    main()
