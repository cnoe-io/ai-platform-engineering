import gc
from common.models.rag import DocumentInfo
from server.loader.url.docsaurus_scraper import scrape_docsaurus
from server.loader.url.mkdocs_scraper import scrape_mkdocs
import aiohttp
from bs4 import BeautifulSoup
import gzip
import os
from typing import List
from urllib.parse import urlparse
from aiofile import async_open
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from typing import Tuple, Dict, Any
import uuid
import datetime
from server.metadata_storage import MetadataStorage
from common.job_manager import JobManager, JobStatus
from common.models.rag import DataSourceInfo
from common.utils import get_logger
import traceback
from common.task_scheduler import TaskScheduler
from langchain_core.vectorstores import VectorStore

class Loader:
    def __init__(self, vstore: VectorStore, metadata_storage: MetadataStorage, datasourceinfo: DataSourceInfo, jobmanager: JobManager):
        """
        Initialize the loader with the given vstore, logger, metadata storage, and datasource.

        Args:
            vstore (VectorStore): The vector storage to use for storing documents.
            metadata_storage (MetadataStorage): The metadata storage to use for storing metadata.
            datasourceinfo (DataSourceInfo): The datasource configuration to use for loading documents.
        """
        self.session = None
        self.vstore = vstore
        self.logger = get_logger(f"loader:{datasourceinfo.datasource_id[12:]}")
        self.metadata_storage = metadata_storage
        self.chunk_size = datasourceinfo.default_chunk_size
        self.chunk_overlap = datasourceinfo.default_chunk_overlap
        self.datasourceinfo = datasourceinfo
        self.jobmanager = jobmanager
        self.max_concurrency = int(os.getenv("MAX_CONCURRENCY", 20))

        # Chrome user agent for better web scraping compatibility
        self.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        # Initialize text splitter for chunking large documents
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            length_function=len,
            separators=["\n\n", "\n", ". ", "? ", "! ", " ", ""]
        )

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10), headers={"User-Agent": self.user_agent}) # 10 seconds timeout
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

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
        self.logger.debug(f"Updated chunking config: size={chunk_size}, overlap={chunk_overlap}")

    async def get_sitemaps(self, url: str) -> List[str]:
        """Return a list of sitemap URLs for the given site.

        Order of checks:
        1) robots.txt for one or more Sitemap: entries
        2) <given_url>/sitemap.xml (or the URL itself if it already ends with sitemap.xml)
        3) <scheme>://<netloc>/sitemap.xml
        """
        if self.session is None:
            raise Exception("Session is not initialized")
        sitemaps: List[str] = []
        parsed = urlparse(url)
        if not parsed.scheme:
            parsed = urlparse("https://" + url)
        base = f"{parsed.scheme}://{parsed.netloc}"

        self.logger.debug(f"Checking robots.txt at: {base}/robots.txt")
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
                    self.logger.debug(f"robots.txt not found or not accessible: {robots_url} (status {resp.status})")
        except Exception as e:
            self.logger.error(traceback.format_exc())
            self.logger.debug(f"Error fetching robots.txt {robots_url}: {e}")

        if sitemaps:
            self.logger.debug(f"Found sitemaps: {sitemaps}")
            return sitemaps

        # 2) <given_url>/sitemap.xml
        if url.endswith("/sitemap.xml"):
            candidate = url
        elif url.endswith("/"):
            candidate = url + "sitemap.xml"
        else:
            candidate = url + "/sitemap.xml"

        self.logger.debug(f"Checking sitemap at: {candidate}")
        try:
            async with self.session.get(candidate, allow_redirects=True) as resp:
                if resp.status == 200:
                    sitemaps.append(str(resp.url))
        except Exception as e:
            self.logger.warning(traceback.format_exc())
            self.logger.debug(f"Error checking sitemap at {candidate}: {e}")

        if sitemaps:
            self.logger.debug(f"Found sitemaps: {sitemaps}")
            return sitemaps

        # 3) <base>/sitemap.xml
        base_sitemap = f"{base}/sitemap.xml"
        self.logger.debug(f"Checking base sitemap at: {base_sitemap}")
        try:
            async with self.session.get(base_sitemap, allow_redirects=True) as resp:
                if resp.status == 200:
                    sitemaps.append(str(resp.url))
        except Exception as e:
            self.logger.warning(traceback.format_exc())
            self.logger.debug(f"Error checking base sitemap at {base_sitemap}: {e}")

        if sitemaps:
            self.logger.debug(f"Found sitemaps: {sitemaps}")
            return sitemaps

        self.logger.debug(f"No sitemaps found at: {url}")
        return []

    async def custom_parser(self, soup: BeautifulSoup, url) -> Tuple[str, Dict[str, Any]]:
        """
        Processes a webpage and save contents to a file.
        Parses webpage based on generator.
        Returns (content, metadata)
        """
        # check meta tag for generator
        content = ""
        generator = None
        generator_tag = soup.find('meta', attrs={'name': 'generator'})
        if generator_tag:
            self.logger.debug(f"Generator tag found: {generator_tag}")
            generator = generator_tag.get('content') # type: ignore
            self.logger.debug(f"Generator: {generator}")
        if generator and "docusaurus" in generator.lower(): # type: ignore
            content = scrape_docsaurus(soup)
        elif generator and "mkdocs" in generator.lower(): # type: ignore
            content = scrape_mkdocs(soup)
            # TODO: Add more processors
        else:
            # If no generator is found, just remove nav and header
            self.logger.debug("No generator found, just removing nav and header")
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
            metadata["description"] = description.get("content", "") # type: ignore
        else:
            metadata["description"] = ""

        if html := soup.find("html"):
            metadata["language"] = html.get("lang", "") # type: ignore
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

    async def process_url(self, url: str, job_id: str):
        """
        Process a URL, fetching the document and splitting into chunks if necessary.
        """
        self.logger.info(f"Processing URL {url}")
        try:
            if self.session is None:
                raise Exception("Session is not initialized")
            async with self.session.get(url, allow_redirects=True) as resp:
                resp.raise_for_status()
                html_content = await resp.text()
                soup = BeautifulSoup(html_content, 'html.parser')
                content, metadata = await self.custom_parser(soup, url)
                doc = Document(id=uuid.uuid4().hex, page_content=content, metadata=metadata)
                await self.process_document(doc, self.datasourceinfo.default_chunk_size, self.datasourceinfo.default_chunk_overlap)
        except Exception as e:
            self.logger.warning(traceback.format_exc())
            self.logger.warning(f"Failed to process URL {url}: {e}")
            await self.jobmanager.update_job(job_id,
                message=f"Failed to process URL {url}",
                failed_increment=1,
            )
        finally:
            await self.jobmanager.update_job(job_id,
                message=f"Processed URL {url}",
                completed_increment=1,
            )
            self.logger.debug(f"DONE Processing URL {url}")


    async def process_document(self, doc: Document, chunk_size: int = 10000, chunk_overlap: int = 2000):
        """
        Process a document, splitting into chunks if necessary, with proper ID management.
        """
        if not self.datasourceinfo:
            self.logger.error("No sourceinfo set for document processing")
            return

        source = doc.metadata.get("source", "<unknown>")
        content = doc.page_content

        self.logger.debug(f"Processing document: {source} ({len(content)} characters)")

        # Generate document ID
        document_id = DocumentInfo.generate_id_from_url(self.datasourceinfo.datasource_id, source)
        doc.id = document_id # Set the LangChain document ID
        
        # Store document info in Redis
        current_time = datetime.datetime.now(datetime.timezone.utc)
        document_info = DocumentInfo(
            document_id=document_id,
            datasource_id=self.datasourceinfo.datasource_id,
            path=source,
            title=doc.metadata.get("title", ""),
            description=doc.metadata.get("description", ""),
            content_length=len(content),
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            chunk_count=0,
            created_at=current_time,
            metadata=doc.metadata
        )

        chunks: List[Document] = []

        # Check if document needs chunking
        if len(content) > chunk_size:
            self.logger.debug("Document exceeds chunk size, splitting into chunks using RecursiveCharacterTextSplitter")

            # Create document-specific text splitter
            document_text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                length_function=len,
                separators=["\n\n", "\n", ". ", "? ", "! ", " ", ""]
            )
            
            doc_chunks = document_text_splitter.split_documents([doc])
            document_info.chunk_count = len(doc_chunks)

            self.logger.debug(f"Split document into {len(doc_chunks)} chunks for: {document_id}")

            for i, chunk_doc in enumerate(doc_chunks):
                chunk_id = doc.id + "_chunk_" + str(i)
                # Add comprehensive metadata to each chunk
                chunk_doc.metadata.update({
                    "id": chunk_id,
                    "datasource_id": self.datasourceinfo.datasource_id,
                    "document_id": document_id,
                    "chunk_index": i,
                    "total_chunks": len(doc_chunks),
                })
                
                chunks.append(chunk_doc)
        else:
            # Process as single document (one chunk)
            self.logger.debug(f"Embedding & adding document: {source}")
            document_info.chunk_count = 1
            chunk_id = doc.id + "_chunk_0"
            
            # Add metadata for single chunk
            doc.metadata.update({
                "id": chunk_id,
                "datasource_id": self.datasourceinfo.datasource_id,
                "document_id": document_id,
                "chunk_index": 0,
                "total_chunks": 1,
            })
            
            chunks.append(doc)
        
        # Add chunks to vector store
        self.logger.debug(f"Adding {len(chunks)} document chunks to vector store")
        await self.vstore.aadd_documents(chunks)
        
        # Store document info in Redis
        await self.metadata_storage.store_document_info(document_info)

    async def get_urls_from_sitemap(self, sitemap_url: str) -> List[str]:
        """
        Fetch a sitemap (or sitemap index) and return a list of page URLs using BeautifulSoup.
        Supports .xml and .xml.gz. Recurses into sitemap indexes. Namespace-safe.
        """
        if self.session is None:
            raise Exception("Session is not initialized")
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
                    self.logger.warning(traceback.format_exc())
                    self.logger.warning(f"Failed to decompress sitemap {sitemap_url}, using raw content")
                    # Some servers send gzip content without actual compression
                    xml_bytes = raw
            else:
                xml_bytes = raw

        # Parse XML via BeautifulSoup with XML parser
        soup = BeautifulSoup(xml_bytes, "xml")

        # Determine if this is a sitemap index
        root = soup.find(True)  # first tag
        root_name = root.name.lower() if root else "" # type: ignore

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

    async def load_url(self, url: str, job_id: str):
        """
        Loads documents from a URL and save contents to a files.
        # TODO: Support saving to S3 or MinIO for storage

        Returns: List of document_ids (filenames for now)
        """
        try:
            await self.jobmanager.update_job(job_id,
                status=JobStatus.IN_PROGRESS,
                message="Checking for sitemaps..."
            )

            # Check if the URL has sitemap
            self.logger.info(f"Checking for sitemaps at: {url}")
            sitemaps = await self.get_sitemaps(url)

            self.logger.debug(f"Found {len(sitemaps)} sitemaps")
            urls = [] # URLs to process

            if not sitemaps: # If no sitemaps found, process the URL directly
                urls = [url]
            else: # If sitemaps found, get URLs from sitemaps
                # Load documents from URLs with streaming processing
                for sitemap_url in sitemaps:
                    self.logger.info(f"Loading sitemap: {sitemap_url}")
                    await self.jobmanager.update_job(job_id,
                        message=f"Getting URLs from sitemap: {sitemap_url}..."
                    )
                    urls.extend(await self.get_urls_from_sitemap(sitemap_url))
            
            await self.jobmanager.update_job(job_id,
                message=f"Found {len(urls)} URLs to process",
                completed_counter=0,
                failed_counter=0,
                total=len(urls))
            
            # Process URLs concurrently with max concurrency (to avoid overloading the system and memory)
            self.logger.info(f"Processing {len(urls)} URLs with max concurrency {self.max_concurrency}")
            tasks = [self.process_url(url, job_id) for url in urls]
            scheduler = TaskScheduler(max_parallel_tasks=self.max_concurrency)
            await scheduler.run(tasks) # Run tasks concurrently # type: ignore

            # Invoke garbage collection to free up memory
            gc.collect()
                
            # Get the job info
            job_info = await self.jobmanager.get_job(job_id)
            if job_info is None: # Unusual case
                self.logger.error(f"Job not found: {job_id}")
                await self.jobmanager.update_job(job_id,
                    status=JobStatus.FAILED,
                    error="Job not found",
                    message="Job not found")
                return

            # Check if all URLs failed to process
            if job_info.failed_counter == job_info.total:
                await self.jobmanager.update_job(job_id,
                    status=JobStatus.FAILED,
                    error="All URLs failed to process",
                    message=f"All {job_info.total} URLs failed to process",
                )
            else:
                await self.jobmanager.update_job(job_id,
                    status=JobStatus.COMPLETED,
                    message=f"Processed: {job_info.total} URLs",
                )

        except Exception as e:
            self.logger.error(traceback.format_exc())
            self.logger.error(f"Error during URL ingestion: {e}")
            await self.jobmanager.update_job(job_id,
                status=JobStatus.FAILED,
                error="Error processing URLs",
                message=f"Failed to process URLs"
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
    
    async def cleanup(self):
        """Clean up resources."""
        if self.session:
            await self.session.close()
            self.session = None