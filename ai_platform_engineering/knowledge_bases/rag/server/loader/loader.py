from .url.docsaurus_scraper import scrape_docsaurus
from .url.mkdocs_scraper import scrape_mkdocs
import aiohttp
from bs4 import BeautifulSoup
import gzip
import logging
import os
from typing import List
from urllib.parse import urlparse
from aiofile import async_open
from langchain_community.document_loaders import WebBaseLoader
from langchain_core.documents import Document
from langchain_core.vectorstores import VectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from typing import Dict, Any, Optional
import uuid
import datetime
import json

class Loader:
    def __init__(self, vstore: VectorStore, logger: logging.Logger, redis_client=None):
        self.session = None
        self.vstore = vstore
        self.logger = logger
        self.redis_client = redis_client
        self.chunk_size = 10000
        self.chunk_overlap = 2000

        # Batch size for URL processing (configurable via environment variable)
        self.batch_size = int(os.getenv("URL_BATCH_SIZE", "5"))

        # Initialize text splitter for chunking large documents
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            length_function=len,
            separators=["\n\n", "\n", ". ", "? ", "! ", " ", ""]
        )

    def set_chunking_config(self, chunk_size: int, chunk_overlap: int):
        """Update chunking configuration and recreate text splitter"""
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            length_function=len,
            separators=["\n\n", "\n", ". ", "? ", "! ", " ", ""]
        )
        self.logger.info(f"Updated chunking config: size={chunk_size}, overlap={chunk_overlap}")

    def set_batch_size(self, batch_size: int):
        """Update batch size for URL processing"""
        self.batch_size = batch_size
        self.logger.info(f"Updated batch size: {batch_size}")

    async def update_job_progress(self, job_id: Optional[str], **updates):
        """Update job progress using Redis if job_id is provided and Redis client exists"""
        if job_id and self.redis_client:
            try:
                # Get current job info
                job_data = await self.redis_client.get(f"job:{job_id}")
                if job_data:
                    job_info = json.loads(job_data)

                    # Update job info
                    for key, value in updates.items():
                        if key == "progress":
                            job_info["progress"].update(value)
                        elif key in ["created_at", "completed_at"]:
                            # Convert datetime to string if it's a datetime object
                            if isinstance(value, datetime.datetime):
                                # Ensure UTC timezone if not already set
                                if value.tzinfo is None:
                                    value = value.replace(tzinfo=datetime.timezone.utc)
                                job_info[key] = value.isoformat()
                            else:
                                job_info[key] = value
                        else:
                            job_info[key] = value

                    # Store back to Redis with expiry
                    await self.redis_client.setex(
                        f"job:{job_id}",
                        3600,  # 1 hour expiry
                        json.dumps(job_info)
                    )

                    self.logger.info(f"Updated job {job_id} with: {updates}")
                else:
                    self.logger.warning(f"Job {job_id} not found in Redis")
            except Exception as e:
                self.logger.error(f"Error updating job progress for {job_id}: {e}")
        else:
            self.logger.warning(f"Cannot update job {job_id}: job_id={job_id}, redis_client exists={bool(self.redis_client)}")

    async def get_sitemaps(self, url: str) -> List[str]:
        """Return a list of sitemap URLs for the given site.

        Order of checks:
        1) robots.txt for one or more Sitemap: entries
        2) <given_url>/sitemap.xml (or the URL itself if it already ends with sitemap.xml)
        3) <scheme>://<netloc>/sitemap.xml
        """
        if not self.session:
            self.session = aiohttp.ClientSession()

        sitemaps: List[str] = []
        parsed = urlparse(url)
        if not parsed.scheme:
            parsed = urlparse("https://" + url)
        base = f"{parsed.scheme}://{parsed.netloc}"

        self.logger.info(f"Checking robots.txt at: {base}/robots.txt")
        # 1) robots.txt
        robots_url = f"{base}/robots.txt"
        try:
            async with self.session.get(robots_url, allow_redirects=True) as resp:
                if resp.status == 200:
                    text = await resp.text()
                    for line in text.splitlines():
                        line = line.strip()
                        if line.lower().startswith("sitemap:"):
                            sitemap_url = line.split(":", 1)[1].strip()
                            if sitemap_url and sitemap_url not in sitemaps:
                                sitemaps.append(sitemap_url)
                else:
                    self.logger.info(f"robots.txt not found or not accessible: {robots_url} (status {resp.status})")
        except Exception as e:
            self.logger.debug(f"Error fetching robots.txt {robots_url}: {e}")

        if sitemaps:
            self.logger.info(f"Found sitemaps: {sitemaps}")
            return sitemaps

        # 2) <given_url>/sitemap.xml
        if url.endswith("/sitemap.xml"):
            candidate = url
        elif url.endswith("/"):
            candidate = url + "sitemap.xml"
        else:
            candidate = url + "/sitemap.xml"

        self.logger.info(f"Checking sitemap at: {candidate}")
        try:
            async with self.session.get(candidate, allow_redirects=True) as resp:
                if resp.status == 200:
                    sitemaps.append(str(resp.url))
        except Exception as e:
            self.logger.debug(f"Error checking sitemap at {candidate}: {e}")

        if sitemaps:
            self.logger.info(f"Found sitemaps: {sitemaps}")
            return sitemaps

        # 3) <base>/sitemap.xml
        base_sitemap = f"{base}/sitemap.xml"
        self.logger.info(f"Checking base sitemap at: {base_sitemap}")
        try:
            async with self.session.get(base_sitemap, allow_redirects=True) as resp:
                if resp.status == 200:
                    sitemaps.append(str(resp.url))
        except Exception as e:
            self.logger.debug(f"Error checking base sitemap at {base_sitemap}: {e}")

        if sitemaps:
            self.logger.info(f"Found sitemaps: {sitemaps}")
            return sitemaps

        self.logger.info(f"No sitemaps found at: {url}")
        return []

    async def custom_parser(self, soup: BeautifulSoup, url) -> (str, Dict[str, Any]):
        """
        Processes a webpage and save contents to a file.
        Returns a formatted string of the webpage based on the generator.
        """
        # check meta tag for generator
        content = ""
        generator = None
        generator_tag = soup.find('meta', attrs={'name': 'generator'})
        if generator_tag:
            self.logger.info(f"Generator tag found: {generator_tag}")
            generator = generator_tag.get('content')
            self.logger.info(f"Generator: {generator}")
        if generator and "docusaurus" in generator.lower():
            content = scrape_docsaurus(soup)
        elif generator and "mkdocs" in generator.lower():
            content = scrape_mkdocs(soup)
            # TODO: Add more processors
        else:
            # If no generator is found, just remove nav and header
            self.logger.info("No generator found, just removing nav and header")
            # Find all 'nav' and 'header' elements in the BeautifulSoup object
            nav_elements = soup.find_all("nav")
            header_elements = soup.find_all("header")

            # Remove each 'nav' and 'header' element from the BeautifulSoup object
            for element in nav_elements + header_elements:
                element.decompose()

            content = soup.get_text(separator='\n', strip=True)

        # Build metadata from BeautifulSoup output.
        # Borrowed from: https://python.langchain.com/api_reference/_modules/langchain_community/document_loaders/web_base.html#WebBaseLoader._build_metadata
        metadata = {"source": url}
        if title := soup.find("title"):
            metadata["title"] = title.get_text()
        else:
            metadata["title"] = ""

        if description := soup.find("meta", attrs={"name": "description"}):
            metadata["description"] = description.get("content", "")
        else:
            metadata["description"] = ""

        if html := soup.find("html"):
            metadata["language"] = html.get("lang", "")
        else:
            metadata["language"] = ""

        return content, metadata

    def sanitize_filename(self, url: str) -> str:
        self.logger.debug(f"Sanitizing filename for URL: {url}")
        parsed = urlparse(url)
        path = parsed.path.strip("/").replace("/", "_")
        filename = path if path else "index"
        self.logger.debug(f"Sanitized filename: {filename}")
        return filename

    async def process_document(self, doc: Document, job_id: Optional[str] = None):
        """
        Process a document, splitting into chunks if necessary.
        """
        self.logger.info(f"Processing document: {doc}")
        source = doc.metadata.get("source", None)
        content = doc.page_content

        self.logger.info(f"Processing document: {source} ({len(content)} characters)")

        # Check if document needs chunking
        if len(content) > self.chunk_size:
            self.logger.info("Document exceeds 10,000 characters, splitting into chunks using RecursiveCharacterTextSplitter")

            # Use LangChain's RecursiveCharacterTextSplitter
            chunk_docs = self.text_splitter.split_documents([doc])

            self.logger.info(f"Length of chunk_docs: {len(chunk_docs)}")

            await self.update_job_progress(job_id,
                status="in_progress",
                progress={"message": f"Splitting page into {len(chunk_docs)} chunks..."}
            )

            # Add chunk metadata to each chunk
            for i, chunk_doc in enumerate(chunk_docs):
                chunk_doc.metadata["chunk_index"] = i
                chunk_doc.metadata["total_chunks"] = len(chunk_docs)
                chunk_doc.metadata["chunk_id"] = f"{doc.id}_chunk_{i}" if doc.id else f"{uuid.uuid4().hex}_chunk_{i}"
                # Ensure each chunk has a unique ID
                if not hasattr(chunk_doc, 'id') or not chunk_doc.id:
                    chunk_doc.id = f"{doc.id}_chunk_{i}" if doc.id else uuid.uuid4().hex

            await self.update_job_progress(job_id,
                status="in_progress",
                progress={"message": f"Adding {len(chunk_docs)} document chunks to vector store..."}
            )
            self.logger.info(f"Split document into {len(chunk_docs)} chunks for: {source}")
            doc_ids = await self.vstore.aadd_documents(chunk_docs)
            self.logger.info(f"Added {len(doc_ids)} document chunks to vector store")
        else:
            # Process as single document
            self.logger.info(f"Embedding & adding document: {source}")

            # Add these to maintian consistency with chunked documents
            doc.metadata["chunk_index"] = 0
            doc.metadata["total_chunks"] = 1
            doc.metadata["chunk_id"] = f"{doc.id}_chunk_0" if doc.id else f"{uuid.uuid4().hex}_chunk_0"
            doc_ids = await self.vstore.aadd_documents([doc])
            self.logger.info(f"Document added to vector store: {doc_ids}")

        # TODO: Return document_id for tracking

    async def get_urls_from_sitemap(self, sitemap_url: str) -> List[str]:
        """
        Fetch a sitemap (or sitemap index) and return a list of page URLs using BeautifulSoup.
        Supports .xml and .xml.gz. Recurses into sitemap indexes. Namespace-safe.
        """
        try:
            if not self.session:
                self.session = aiohttp.ClientSession()

            self.logger.info(f"Fetching sitemap: {sitemap_url}")
            async with self.session.get(sitemap_url, allow_redirects=True) as resp:
                if resp.status != 200:
                    self.logger.warning(f"Failed to fetch sitemap {sitemap_url}: HTTP {resp.status}")
                    return []

                raw = await resp.read()
                content_type = resp.headers.get("Content-Type", "").lower()
                if sitemap_url.endswith(".gz") or "gzip" in content_type:
                    try:
                        xml_bytes = gzip.decompress(raw)
                    except Exception:
                        # Some servers send gzip content without actual compression
                        xml_bytes = raw
                else:
                    xml_bytes = raw

            # Parse XML via BeautifulSoup with XML parser
            soup = BeautifulSoup(xml_bytes, "xml")

            # Determine if this is a sitemap index
            root = soup.find(True)  # first tag
            root_name = root.name.lower() if root else ""

            def find_all_locs(s: BeautifulSoup) -> List[str]:
                locs: List[str] = []
                for tag in s.find_all(lambda t: isinstance(t.name, str) and t.name.lower().endswith("loc")):
                    text = tag.get_text(strip=True)
                    if text:
                        locs.append(text)
                return locs

            if root_name.endswith("sitemapindex"):
                # Recurse into child sitemaps
                child_sitemaps = find_all_locs(soup)
                self.logger.info(f"Found {len(child_sitemaps)} child sitemaps in index")
                urls: List[str] = []
                for child in child_sitemaps:
                    urls.extend(await self.get_urls_from_sitemap(child))
                # Deduplicate preserving order
                seen = set()
                deduped: List[str] = []
                for u in urls:
                    if u not in seen:
                        deduped.append(u)
                        seen.add(u)
                return deduped
            else:
                # Regular urlset sitemap
                urls = find_all_locs(soup)
                self.logger.info(f"Extracted {len(urls)} URLs from sitemap")
                return urls

        except Exception as e:
            self.logger.error(f"Unexpected error reading sitemap {sitemap_url}: {e}")
            return []

    async def load_url(self, url: str, job_id: Optional[str] = None):
        """
        Loads documents from a URL and save contents to a files.
        # TODO: Support saving to S3 or MinIO for storage

        Returns: List of document_ids (filenames for now)
        """
        try:
            await self.update_job_progress(job_id,
                status="in_progress",
                progress={"message": "Checking for sitemaps...", "processed": 0, "total": 0}
            )

            # Check if the URL has sitemap
            self.logger.info(f"Checking for sitemaps at: {url}")
            sitemaps = await self.get_sitemaps(url)

            if not sitemaps:
                self.logger.info(f"No sitemaps found at: {url}")
                await self.update_job_progress(job_id,
                    progress={"message": "No sitemaps found, processing single URL...", "processed": 0, "total": 1}
                )

                # Use synchronous loading to avoid event loop conflicts
                loader = WebBaseLoader(
                    requests_per_second=1
                )
                docs = await loader.ascrape_all([url])
                for doc in docs:
                    self.logger.info(f"Processing single URL: {url}")
                    # WebBaseLoader already parsed the HTML and extracted content
                    # Just update the document ID and source metadata
                    doc.id = uuid.uuid4().hex
                    doc.metadata["source"] = url
                    await self.process_document(doc, job_id)

                await self.update_job_progress(job_id,
                    status="completed",
                    completed_at=datetime.datetime.now(),
                    progress={"message": "Successfully processed 1 URL", "processed": 1, "total": 1}
                )
                return

            # Load documents from URLs with streaming processing
            for sitemap_url in sitemaps:
                self.logger.info(f"Loading sitemap: {sitemap_url}")
                await self.update_job_progress(job_id,
                    progress={"message": f"Getting URLs from sitemap: {sitemap_url}...", "processed": 0, "total": 0}
                )

                urls = await self.get_urls_from_sitemap(sitemap_url)
                total_urls = len(urls)

                await self.update_job_progress(job_id,
                    progress={"message": f"Found {total_urls} URLs to process", "processed": 0, "total": total_urls}
                )


                # Process URLs in batches to balance memory usage and efficiency
                processed_count = 0
                for i in range(0, len(urls), self.batch_size):
                    batch_urls = urls[i:i + self.batch_size]
                    batch_num = (i // self.batch_size) + 1
                    total_batches = (len(urls) + self.batch_size - 1) // self.batch_size
                    self.logger.info(f"Processing batch {batch_num}/{total_batches} ({len(batch_urls)} URLs)")

                    await self.update_job_progress(job_id,
                        progress={"message": f"Processing batch {batch_num}/{total_batches} ({len(batch_urls)} URLs)", "processed": processed_count, "total": total_urls}
                    )

                    try:
                        # Load batch of URLs to balance memory usage and efficiency
                        # Use asyncio.to_thread to run the synchronous load() method in a thread pool
                        import asyncio
                        loader = WebBaseLoader(batch_urls, requests_per_second=1)
                        docs = await asyncio.to_thread(loader.load)

                        for doc in docs:
                            # Extract source URL from document metadata if available, otherwise use the first URL in batch
                            source_url = doc.metadata.get("source", batch_urls[0])
                            # WebBaseLoader already parsed the HTML and extracted content
                            # Just update the document ID and source metadata
                            doc.id = uuid.uuid4().hex
                            doc.metadata["source"] = source_url
                            await self.process_document(doc, job_id)
                            processed_count += 1

                        # Force garbage collection after each batch to free memory
                        import gc
                        gc.collect()

                    except Exception as e:
                        self.logger.warning(f"Failed to process batch {batch_num}: {e}")
                        # Mark all URLs in this batch as failed
                        processed_count += len(batch_urls)
                        continue

                await self.update_job_progress(job_id,
                    status="completed",
                    completed_at=datetime.datetime.now(),
                    progress={"message": f"Successfully processed {total_urls} URLs", "processed": total_urls, "total": total_urls}
                )
                return

        except Exception as e:
            self.logger.error(f"Error during URL ingestion: {e}")
            await self.update_job_progress(job_id,
                status="failed",
                completed_at=datetime.datetime.now(),
                error=str(e),
                progress={"message": f"Failed: {str(e)}", "processed": 0, "total": 0}
            )
            raise

    async def save_to_file(self, filename: str, content: str):
        # create folder if not exists
        os.makedirs("documents", exist_ok=True)
        self.logger.info("Saving document to file: documents/"+filename)
        # Use aiofiles for async file operations, but for now use asyncio.to_thread
        async with async_open("documents/"+filename, "w") as f:
            await f.write(content)

    async def close(self):
        """Close the aiohttp session"""
        if self.session:
            await self.session.close()
            self.session = None