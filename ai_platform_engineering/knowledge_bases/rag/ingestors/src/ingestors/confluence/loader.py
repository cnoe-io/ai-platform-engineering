"""Confluence-specific utilities for authenticated web loading and document ID generation.

This module provides helper functions for creating authenticated Confluence sessions,
generating datasource and document IDs, and enhancing metadata with Confluence-specific fields.
"""

import time
import hashlib
import traceback
from typing import Dict, List, Any, Tuple, Optional
from urllib.parse import urlparse
import aiohttp
from aiohttp_retry import RetryClient, ExponentialRetry
from aiohttp import ClientTimeout
from bs4 import BeautifulSoup
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from common.job_manager import JobManager, JobStatus
from common.models.rag import DataSourceInfo, DocumentMetadata
from common.utils import get_logger

logger = get_logger(__name__)

# Configuration constants
CONFLUENCE_BATCH_SIZE = 100  # Documents per batch
CONFLUENCE_API_PAGE_LIMIT = 100  # Pages per API call for pagination


def generate_datasource_id(confluence_url: str, space_key: str) -> str:
    """Generate datasource ID for a Confluence space or page.

    Format: src_confluence___{domain_normalized}__{space_key}[__{page_id}]

    Args:
        confluence_url: Base URL of the Confluence instance
        space_key: Confluence space key
    Returns:
        Datasource ID string
    """
    domain = urlparse(confluence_url).netloc.replace(".", "_").replace("-", "_")

    return f"src_confluence___{domain}__{space_key}"


class ConfluenceLoader:
    """Loader for fetching and ingesting Confluence pages."""

    def __init__(
        self,
        rag_client,
        job_manager: JobManager,
        datasource_info: DataSourceInfo,
        confluence_url: str,
        username: str,
        token: str,
        verify_ssl: bool,
        max_concurrency: int,
    ):
        self.rag_client = rag_client
        self.job_manager = job_manager
        self.datasource_info = datasource_info
        self.confluence_url = confluence_url
        self.max_concurrency = max_concurrency
        self.logger = get_logger(
            f"confluence_loader:{datasource_info.datasource_id[16:]}"
        )

        # Chunking configuration
        self.chunk_size = datasource_info.default_chunk_size
        self.chunk_overlap = datasource_info.default_chunk_overlap
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
        )

        self.session = None
        self._auth = (username, token)
        self._verify_ssl = verify_ssl

    async def __aenter__(self):
        """Set up retry-enabled session."""
        retry_options = ExponentialRetry(
            attempts=4,
            start_timeout=1.0,
            max_timeout=60.0,
            factor=2.0,
            statuses={429, 502, 503, 504},
        )

        base_session = aiohttp.ClientSession(
            timeout=ClientTimeout(total=30),
            auth=aiohttp.BasicAuth(*self._auth),
            connector=aiohttp.TCPConnector(verify_ssl=self._verify_ssl),
            headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (compatible; ConfluenceRAGIngestor/1.0)",
            },
        )
        self.session = RetryClient(
            client_session=base_session, retry_options=retry_options
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Close session."""
        if self.session:
            await self.session.close()

    async def fetch_child_pages(
        self, parent_page_id: str
    ) -> Tuple[List[str], List[Tuple[str, str]]]:
        """Fetch direct child page IDs for a parent page.

        Uses Confluence REST API v1: GET /rest/api/content/{id}/child/page

        Args:
            parent_page_id: ID of the parent page

        Returns:
            Tuple of (child_page_ids, failed_fetches)
            - child_page_ids: List of direct child page IDs
            - failed_fetches: List of (identifier, error_msg) tuples where identifier is the page_id or error type
        """
        child_ids = []
        failed_fetches = []
        start = 0

        while True:
            try:
                url = f"{self.confluence_url}/rest/api/content/{parent_page_id}/child/page"
                params = {
                    "start": start,
                    "limit": CONFLUENCE_API_PAGE_LIMIT,
                    "expand": "id,title",
                }

                async with self.session.get(url, params=params) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        batch = data.get("results", [])

                        if not batch:
                            break

                        # Extract IDs
                        for child in batch:
                            child_id = child.get("id")
                            if child_id:
                                child_ids.append(child_id)
                            else:
                                self.logger.warning(
                                    f"Child page missing ID in response: {child}"
                                )

                        start += len(batch)

                        if len(batch) < CONFLUENCE_API_PAGE_LIMIT:
                            break
                    else:
                        text = await resp.text()
                        error_msg = f"Failed to fetch children of {parent_page_id}: {resp.status} - {text}"
                        self.logger.warning(error_msg)
                        failed_fetches.append((parent_page_id, error_msg))
                        break
            except Exception as e:
                error_msg = f"Error fetching children of {parent_page_id}: {e}"
                self.logger.error(error_msg)
                failed_fetches.append((parent_page_id, error_msg))
                break

        return child_ids, failed_fetches

    def extract_text_from_html(self, html_content: str) -> str:
        """Extract text from Confluence HTML storage format.

        Args:
            html_content: HTML content from Confluence

        Returns:
            Plain text content
        """
        soup = BeautifulSoup(html_content, "html.parser")
        text = soup.get_text(separator="\n", strip=True)
        return text

    async def fetch_page_content(
        self, page_id: str
    ) -> Tuple[Optional[Dict], Optional[Tuple[str, str]]]:
        """Fetch single page. Returns (page, None) on success or (None, (page_id, error)) on failure."""
        try:
            url = f"{self.confluence_url}/rest/api/content/{page_id}"
            params = {"expand": "body.storage,version,space,history"}
            async with self.session.get(url, params=params) as resp:
                if resp.status == 200:
                    return await resp.json(), None
                text = await resp.text()
                return None, (
                    page_id,
                    f"Failed to fetch page {page_id}: {resp.status} - {text}",
                )
        except Exception as e:
            return None, (page_id, f"Error fetching page {page_id}: {e}")

    async def load_pages(
        self,
        space_key: str,
        page_configs: Optional[List[Dict[str, Any]]] = None,
        page_limit: int = CONFLUENCE_API_PAGE_LIMIT,
    ) -> Tuple[List[Dict[str, Any]], List[Tuple[str, str]]]:
        """Load pages from Confluence space via REST API.

        Args:
            space_key: Confluence space key
            page_configs: List of page config dicts, each with:
                - page_id (required): Page ID to fetch
                - get_child_pages (optional, default False): Include direct children
            page_limit: Number of pages per API call for enumeration

        Returns:
            tuple: (list of successfully fetched pages, list of (page_id, error_msg) tuples)
        """
        self.logger.info(f"Loading pages from space {space_key}")
        self.logger.debug(
            f"Loading pages with space_key={space_key}, page_configs={page_configs}"
        )
        pages = []
        failed_pages = []

        if page_configs:
            for config in page_configs:
                page_id = config.get("page_id")
                if not page_id:
                    self.logger.warning(f"Page config missing page_id: {config}")
                    continue

                # Fetch parent page
                page, failure = await self.fetch_page_content(page_id)
                if page:
                    pages.append(page)
                if failure:
                    failed_pages.append(failure)
                    continue

                # Fetch child pages if requested
                if config.get("get_child_pages", False):
                    child_ids, child_failures = await self.fetch_child_pages(page_id)
                    failed_pages.extend(child_failures)

                    for child_id in child_ids:
                        child_page, child_failure = await self.fetch_page_content(
                            child_id
                        )
                        if child_page:
                            pages.append(child_page)
                        if child_failure:
                            failed_pages.append(child_failure)
        else:
            # Enumerate entire space
            start = 0
            while True:
                try:
                    url = f"{self.confluence_url}/rest/api/content"
                    params = {
                        "spaceKey": space_key,
                        "type": "page",
                        "start": start,
                        "limit": page_limit,
                        "expand": "body.storage,version,space,history",
                    }
                    async with self.session.get(url, params=params) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            batch = data.get("results", [])
                            if not batch:
                                break
                            pages.extend(batch)
                            start += len(batch)
                            if len(batch) < page_limit:
                                break
                        else:
                            text = await resp.text()
                            self.logger.error(
                                f"Error fetching pages from {space_key}: {resp.status} - {text}"
                            )
                            failed_pages.append(
                                (
                                    space_key,
                                    f"Error fetching pages from {space_key}: {resp.status} - {text}",
                                )
                            )
                            break
                except Exception as e:
                    self.logger.error(f"Error enumerating {space_key}: {e}")
                    self.logger.error(traceback.format_exc())
                    failed_pages.append(
                        (space_key, f"Error enumerating {space_key}: {e}")
                    )
                    break

        self.logger.info(
            f"Fetched {len(pages)} pages from space {space_key}, {len(failed_pages)} failures"
        )
        return pages, failed_pages

    async def ingest_pages(self, pages: List[Dict[str, Any]], job_id: str):
        """Ingest pages by extracting content, chunking, and sending to RAG.

        Args:
            pages: List of page metadata dicts (must include 'id' field)
            job_id: Job ID for tracking progress
        """
        all_documents = []

        for page in pages:
            page_id = page.get("id")
            if not page_id:
                self.logger.warning(f"Page missing ID, skipping: {page}")
                continue

            try:
                html_content = (
                    page.get("body", {}).get("storage", {}).get("value", "")
                )

                # Extract text
                text = self.extract_text_from_html(html_content)

                if not text.strip():
                    self.logger.warning(f"Page {page_id} has no content, skipping")
                    await self.job_manager.increment_progress(job_id)
                    continue

                # Split into chunks
                chunks = self.text_splitter.split_text(text)

                # Extract base metadata from v1 API response
                page_title = page.get("title", "")
                space_key = page.get("space", {}).get("key", "")
                space_name = page.get("space", {}).get("name", "")
                page_url = self.confluence_url + page.get("_links", {}).get(
                    "webui", ""
                )
                created_date = page.get("history", {}).get("createdDate", "")
                last_modified = (
                    page.get("history", {}).get("lastUpdated", {}).get("when", "")
                )
                version = page.get("version", {}).get("number", 1)
                author = (
                    page.get("history", {})
                    .get("createdBy", {})
                    .get("displayName", "")
                )

                # Create Document objects for each chunk
                for i, chunk in enumerate(chunks):
                    # Generate unique document ID for this chunk
                    doc_id_base = (
                        f"{self.datasource_info.datasource_id}_{page_id}_chunk_{i}"
                    )
                    doc_id = hashlib.sha256(doc_id_base.encode()).hexdigest()

                    # Build additional metadata
                    additional_metadata = {
                        "page_id": page_id,
                        "space_key": space_key,
                        "space_name": space_name,
                        "url": page_url,
                        "created_date": created_date,
                        "last_modified": last_modified,
                        "version": version,
                        "author": author,
                        "chunk_index": i,
                        "total_chunks": len(chunks),
                        "source": "confluence",
                    }

                    # Create DocumentMetadata with all required fields
                    doc_metadata = DocumentMetadata(
                        document_id=doc_id,
                        datasource_id=self.datasource_info.datasource_id,
                        ingestor_id=self.rag_client.ingestor_id,
                        title=page_title,
                        description=f"Chunk {i+1}/{len(chunks)} from {page_title}",
                        document_type="confluence_page",
                        document_ingested_at=int(time.time()),
                        fresh_until=0,
                        is_graph_entity=False,
                        metadata=additional_metadata,
                    )

                    doc = Document(
                        id=doc_id,
                        page_content=chunk,
                        metadata=doc_metadata.model_dump(),
                    )
                    all_documents.append(doc)

                    # Batch ingestion
                    if len(all_documents) >= CONFLUENCE_BATCH_SIZE:
                        await self._ingest_batch(all_documents, job_id)
                        all_documents = []

                # Update progress
                await self.job_manager.increment_document_count(job_id, 1)
                await self.job_manager.increment_progress(job_id)
                await self.job_manager.upsert_job(
                    job_id, message=f"Processed page: {page.get('title', page_id)}"
                )

            except Exception as e:
                error_msg = f"Page {page_id}: {str(e)}"
                self.logger.error(f"Error processing page {page_id}: {e}")
                await self.job_manager.add_error_msg(job_id, error_msg)
                await self.job_manager.increment_failure(
                    job_id=job_id, message=error_msg
                )
                await self.job_manager.increment_progress(job_id)

        # Ingest remaining documents
        if all_documents:
            await self._ingest_batch(all_documents, job_id)

        # Set final job status with message
        job = await self.job_manager.get_job(job_id)
        if job.status == JobStatus.TERMINATED:
            await self.job_manager.upsert_job(
                job_id=job_id,
                status=JobStatus.TERMINATED,
                message="Job was terminated during page processing.",
            )
        elif job.failed_counter and job.failed_counter == job.total:
            await self.job_manager.upsert_job(
                job_id=job_id,
                status=JobStatus.FAILED,
                message=f"All {job.total} pages failed to process",
            )
        elif job.failed_counter and job.failed_counter > 0:
            await self.job_manager.upsert_job(
                job_id=job_id,
                status=JobStatus.COMPLETED_WITH_ERRORS,
                message=f"Processed {job.progress_counter} pages with {job.failed_counter} failures",
            )
        else:
            await self.job_manager.upsert_job(
                job_id=job_id,
                status=JobStatus.COMPLETED,
                message=f"Processed: {job.total} pages",
            )

    async def _ingest_batch(self, documents: List[Document], job_id: str):
        """Send batch of documents to RAG server.

        Args:
            documents: List of Document objects to ingest
            job_id: Job ID for tracking
        """
        try:
            await self.rag_client.ingest_documents(
                job_id=job_id,
                datasource_id=self.datasource_info.datasource_id,
                documents=documents,
            )
            self.logger.debug(f"Ingested batch of {len(documents)} documents")
        except Exception as e:
            self.logger.error(f"Error ingesting batch: {e}")
            raise
