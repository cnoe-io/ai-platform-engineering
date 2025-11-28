import gc
import time
from common import utils
from loader.url.docsaurus_scraper import scrape_docsaurus
from loader.url.mkdocs_scraper import scrape_mkdocs
import aiohttp
from aiohttp_retry import RetryClient, ExponentialRetry
from bs4 import BeautifulSoup
import gzip
from typing import List
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from typing import Tuple, Dict, Any
from common.job_manager import JobStatus, JobManager
from common.models.rag import DataSourceInfo, DocumentMetadata
from common.utils import get_logger
import traceback
from common.task_scheduler import TaskScheduler
from common.ingestor import Client
from urllib.parse import urlparse

class Loader:
    def __init__(self, rag_client: Client, jobmanager: JobManager, datasourceinfo: DataSourceInfo, max_concurrency: int):
        """
        Initialize the loader with the given vstore, logger, metadata storage, and datasource.

        Args:
            vstore (VectorStore): The vector storage to use for storing documents.
            metadata_storage (MetadataStorage): The metadata storage to use for storing metadata.
            datasourceinfo (DataSourceInfo): The datasource configuration to use for loading documents.
        """
        self.session = None
        self.logger = get_logger(f"loader:{datasourceinfo.datasource_id[12:]}")
        self.chunk_size = datasourceinfo.default_chunk_size
        self.chunk_overlap = datasourceinfo.default_chunk_overlap
        self.datasourceinfo = datasourceinfo
        self.max_concurrency = max_concurrency
        self.jobmanager = jobmanager
        self.client = rag_client

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
        # Configure retry policy for rate limiting and transient errors
        retry_options = ExponentialRetry(
            attempts=4,         # 3 retries + 1 initial attempt
            start_timeout=1.0,  # Start with 1 second delay
            max_timeout=60.0,   # Cap at 60 seconds
            factor=2.0,         # Double delay each time
            statuses={429, 502, 503, 504},  # Retry on rate limit and server errors
            exceptions={aiohttp.ClientError, aiohttp.ServerTimeoutError}
        )
        
        base_session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=30), 
            headers={"User-Agent": self.user_agent}
        )
        self.session = RetryClient(client_session=base_session, retry_options=retry_options)
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
    


    async def process_url(self, url: str, job_id: str, batch: List[Document]):
        """
        Process a URL, fetching the document and adding it to the batch.
        """
        try:
            self.logger.info(f"Processing URL {url}")

            assert self.client.ingestor_id is not None, "Ingestor ID is None, Ingestor client not initialized properly"
            
            # Check if job is terminated
            if await self.jobmanager.is_job_terminated(job_id):
                self.logger.debug(f"Job {job_id} is terminated. Stopping processing of URL {url}.")
                return
            
            # Sanitize URL
            url = utils.sanitize_url(url)
            self.logger.debug(f"Processing sanitized URL {url}")
            if self.session is None:
                raise Exception("Session is not initialized")
            
            # Fetch the URL content
            async with self.session.get(url, allow_redirects=True, max_redirects=10) as resp:
                self.logger.debug(f"Received response: {resp.status} for URL: {url}")
                resp.raise_for_status()
                html_content = await resp.text()
                soup = BeautifulSoup(html_content, 'html.parser')
                content, metadata = await self.custom_parser(soup, url)
                doc_id = utils.generate_document_id_from_url(self.datasourceinfo.datasource_id, url)
                doc = Document(id=doc_id, page_content=content, 
                               metadata=DocumentMetadata(
                                    datasource_id=self.datasourceinfo.datasource_id,
                                    description=metadata.get("description", ""),
                                    title=metadata.get("title", ""),
                                    document_id=doc_id,
                                    document_ingested_at=int(time.time()),
                                    document_type="webpage",
                                    fresh_until=0, # to be set later
                                    ingestor_id=self.client.ingestor_id,
                                    is_graph_entity=False,
                                    metadata=metadata
                                ).model_dump())
                
                # Add document to batch instead of ingesting immediately
                batch.append(doc)

        except aiohttp.TooManyRedirects as e:
            self.logger.error(f"TooManyRedirects error: {e}")
            # Print redirect history for debugging
            if hasattr(e, 'history'):
                for resp in e.history:
                    self.logger.error(f"Redirected from: {resp.url} with status {resp.status}")

            await self.jobmanager.increment_failure(
                job_id=job_id,
                message=f"Failed: Too many redirects - URL: {url} : {type(e).__name__} {e} "
            )
        except Exception as e:
            self.logger.error(traceback.format_exc())
            self.logger.error(f"Failed to load URL {url}: {e}")

            await self.jobmanager.increment_failure(
                job_id=job_id,
                message=f"Failed to load URL {url} : {type(e).__name__} {e} "
            )
        finally:
            await self.jobmanager.increment_progress(
                job_id=job_id,
            )
            await self.jobmanager.upsert_job(
                job_id=job_id,
                message=f"Processed URL: {url}"
            )
            self.logger.debug(f"DONE Processing URL {url}")


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

    async def load_url(self, url: str, job_id: str, check_for_site_map: bool = False, sitemap_max_urls: int = 0):
        """
        Loads documents from a URL and save contents to a files.
        # TODO: Support saving to S3 or MinIO for storage

        Returns: List of document_ids (filenames for now)
        """
        try:
            urls = [] # URLs to process
            if check_for_site_map:
                # Check if the URL has sitemap
                await self.jobmanager.upsert_job(
                    job_id=job_id,
                    status=JobStatus.IN_PROGRESS,
                    message="Checking for sitemaps..."
                )
                self.logger.info(f"Checking for sitemaps at: {url}")
                sitemaps = await self.get_sitemaps(url)
                self.logger.debug(f"Found {len(sitemaps)} sitemaps")
                
            else:
                self.logger.info("Skipping sitemap check as per request")
                sitemaps = []

            if not sitemaps: # If no sitemaps found, process the URL directly
                self.logger.info(f"No sitemaps, processing the URL directly: {url}")
                urls = [url]
            else: # If sitemaps found, get URLs from sitemaps
                # Load documents from URLs with streaming processing
                for sitemap_url in sitemaps:
                    self.logger.info(f"Loading sitemap: {sitemap_url}")
                    await self.jobmanager.upsert_job(
                        job_id=job_id,
                        message=f"Getting URLs from sitemap: {sitemap_url}..."
                    )
                    urls.extend(await self.get_urls_from_sitemap(sitemap_url))

                    # Respect maximum URLs limit if set
                    if sitemap_max_urls > 0 and len(urls) >= sitemap_max_urls:
                        self.logger.info(f"Reached maximum URLs limit from sitemap: {sitemap_max_urls}")
                        urls = urls[:sitemap_max_urls]
                        break
            
            await self.jobmanager.upsert_job(
                job_id=job_id,
                message=f"Found {len(urls)} URLs to process",
                total=len(urls))
            
            # Process URLs concurrently with batching
            self.logger.info(f"Processing {len(urls)} URLs with max concurrency {self.max_concurrency}")
            batch: List[Document] = []
            batch_size = 100
            
            async def process_and_flush(url: str):
                """Process URL and flush batch if needed"""

                # process the URL and add to batch
                await self.process_url(url, job_id, batch)
                
                # Check if batch is full
                if len(batch) >= batch_size:
                    # Flush the batch
                    docs_to_send = batch[:batch_size]
                    del batch[:batch_size]
                    
                    self.logger.info(f"Flushing batch of {len(docs_to_send)} documents")
                    await self.client.ingest_documents(
                        job_id=job_id,
                        datasource_id=self.datasourceinfo.datasource_id,
                        documents=docs_to_send
                    )
            
            tasks = [process_and_flush(url) for url in urls]
            scheduler = TaskScheduler(max_parallel_tasks=self.max_concurrency)
            await scheduler.run(tasks) # type: ignore
            
            # Flush remaining documents in batch
            if batch:
                self.logger.info(f"Flushing final batch of {len(batch)} documents")
                await self.client.ingest_documents(
                    job_id=job_id,
                    datasource_id=self.datasourceinfo.datasource_id,
                    documents=batch
                )

            # Invoke garbage collection to free up memory
            gc.collect()
                
            # Check if job was deleted during processing
            job =  await self.jobmanager.get_job(job_id)
            if job is None:
                self.logger.error(f"Job not found when finalizing: {job_id}")
                return

            # Check if job was terminated
            if job.status == JobStatus.TERMINATED:
                self.logger.info(f"Job {job_id} was terminated during URL processing.")
                await self.jobmanager.upsert_job(
                    job_id=job_id,
                    status=JobStatus.TERMINATED,
                    message="Job was terminated during URL processing."
                )
            # Determine final job status
            elif job.failed_counter and job.failed_counter == job.total:
                await self.jobmanager.upsert_job(
                    job_id=job_id,
                    status=JobStatus.FAILED,
                    message=f"All {job.total} URLs failed to process",
                )
            elif job.failed_counter and job.failed_counter > 0:
                await self.jobmanager.upsert_job(
                    job_id=job_id,
                    status=JobStatus.COMPLETED_WITH_ERRORS,
                    message=f"Processed {job.progress_counter} URLs with {job.failed_counter} failures",
                )
            else:
                await self.jobmanager.upsert_job(
                    job_id=job_id,
                    status=JobStatus.COMPLETED,
                    message=f"Processed: {job.total} URLs",
                )

        except Exception as e:
            self.logger.error(traceback.format_exc())
            self.logger.error(f"Error during URL ingestion: {e}")
            await self.jobmanager.increment_failure(
                job_id=job_id,
                message=f"Error during URL ingestion: {type(e).__name__} {e}"
            )
            await self.jobmanager.upsert_job(
                job_id=job_id,
                status=JobStatus.FAILED,
                message="Failed to process URLs"
            )
            raise

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