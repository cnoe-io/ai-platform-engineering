"""Confluence-specific utilities for authenticated web loading and document ID generation.

This module provides helper functions for creating authenticated Confluence sessions,
generating datasource and document IDs, and enhancing metadata with Confluence-specific fields.
"""

import time
import hashlib
from typing import Dict, List, Any, Tuple
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


async def create_confluence_session(
    confluence_url: str, username: str, token: str, verify_ssl: bool
) -> aiohttp.ClientSession:
    """Create authenticated aiohttp session for Confluence API.

    Args:
        confluence_url: Base URL of the Confluence instance
        username: Confluence username or email
        token: Confluence API token or password
        verify_ssl: Whether to verify SSL certificates

    Returns:
        Configured aiohttp ClientSession with authentication
    """
    auth = aiohttp.BasicAuth(username, token)
    connector = aiohttp.TCPConnector(verify_ssl=verify_ssl)
    session = aiohttp.ClientSession(
        auth=auth,
        connector=connector,
        timeout=aiohttp.ClientTimeout(total=30),
        headers={"User-Agent": "Mozilla/5.0 (compatible; ConfluenceRAGIngestor/1.0)"},
    )
    return session


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

    async def fetch_page_content(self, page_id: str) -> Tuple[Dict[str, Any], str]:
        """Fetch full page content from Confluence REST API (v1).

        Args:
            page_id: Confluence page ID

        Returns:
            Tuple of (page_metadata, html_content)
        """
        url = f"{self.confluence_url}/rest/api/content/{page_id}"
        params = {"expand": "body.storage,version,space,history"}

        async with self.session.get(url, params=params) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise ValueError(
                    f"Failed to fetch page {page_id}: {resp.status} - {text}"
                )

            page_data = await resp.json()

            # Extract HTML content from v1 API response
            html_content = page_data.get("body", {}).get("storage", {}).get("value", "")

            return page_data, html_content

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
                # Fetch full page content
                page_data, html_content = await self.fetch_page_content(page_id)

                # Extract text
                text = self.extract_text_from_html(html_content)

                if not text.strip():
                    self.logger.warning(f"Page {page_id} has no content, skipping")
                    await self.job_manager.increment_progress(job_id)
                    continue

                # Split into chunks
                chunks = self.text_splitter.split_text(text)

                # Extract base metadata from v1 API response
                page_title = page_data.get("title", "")
                space_key = page_data.get("space", {}).get("key", "")
                space_name = page_data.get("space", {}).get("name", "")
                page_url = self.confluence_url + page_data.get("_links", {}).get(
                    "webui", ""
                )
                created_date = page_data.get("history", {}).get("createdDate", "")
                last_modified = (
                    page_data.get("history", {}).get("lastUpdated", {}).get("when", "")
                )
                version = page_data.get("version", {}).get("number", 1)
                author = (
                    page_data.get("history", {})
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
                await self.job_manager.increment_progress(job_id)
                await self.job_manager.upsert_job(
                    job_id, message=f"Processed page: {page_data.get('title', page_id)}"
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
