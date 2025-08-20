from ai_platform_engineering.knowledge_bases.rag.server.rag_api import vector_db
from loader.url.docsaurus_scraper import scrape_docsaurus
from loader.url.mkdocs_scraper import scrape_mkdocs
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
from typing import Dict, Any
import uuid

class Loader:
    def __init__(self, vstore: VectorStore, logger: logging.Logger):
        self.session = None
        self.vstore = vstore
        self.logger = logger
    
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
        generator_tag = soup.find('meta', attrs={'name': 'generator'})
        if generator_tag:
            self.logger.info(f"Generator tag found: {generator_tag}")
            generator = generator_tag.get('content')
            self.logger.info(f"Generator: {generator}")
            if "docusaurus" in generator.lower():
                content = scrape_docsaurus(soup)
            elif "mkdocs" in generator.lower():
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
        if description := soup.find("meta", attrs={"name": "description"}):
            metadata["description"] = description.get("content", "No description found.")
        if html := soup.find("html"):
            metadata["language"] = html.get("lang", "No language found.")

        return content, metadata

    def sanitize_filename(self, url: str) -> str:
        self.logger.debug(f"Sanitizing filename for URL: {url}")
        parsed = urlparse(url)
        path = parsed.path.strip("/").replace("/", "_")
        filename = path if path else "index"
        self.logger.debug(f"Sanitized filename: {filename}")
        return filename

    async def process_document(self, doc: Document):
        """
        Process a document.
        """
        # Use source as filename if available, else use UUID
        source = doc.metadata.get("source", None)

        # TODO: Check for duplicate

        self.logger.info(f"Processing document: {source}")
        # filename = document_id + ".txt"

        # TODO: Use UUID and store reference in a proper database
        # await self.save_to_file(filename, doc.page_content)

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

    async def load_url(self, url: str):
        """
        Loads documents from a URL and save contents to a files.
        # TODO: Support saving to S3 or MinIO for storage

        Returns: List of document_ids (filenames for now)
        """
                
        # Check if the URL has sitemap
        self.logger.info(f"Checking for sitemaps at: {url}")
        sitemaps = await self.get_sitemaps(url)
        
        if not sitemaps:
            self.logger.info(f"No sitemaps found at: {url}")
            loader = WebBaseLoader(url)
            doc = await loader.aload()
            await self.process_document(doc)
            return

        # Load documents from URLs
        for sitemap_url in sitemaps:
            self.logger.info(f"Loading sitemap: {sitemap_url}")
            urls = await self.get_urls_from_sitemap(sitemap_url)
            loader = WebBaseLoader()
            for i, soup in enumerate(await loader.ascrape_all(urls)):
                content, metadata = await self.custom_parser(soup, urls[i])
                doc = Document(id=uuid.uuid4().hex, page_content=content, metadata=metadata)
                await self.process_document(doc)
            return

    
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
