"""
Base spider with shared functionality for all web scrapers.

Provides common parsing logic, Playwright integration, and job management.
"""

from typing import Optional, Iterator, Any
import scrapy
from scrapy.http import Response, Request

from common.models.server import ScrapySettings
from common.models.rag import DataSourceInfo
from common.job_manager import JobManager
from common.ingestor import Client
from common.utils import get_logger

from ..items import ScrapedPageItem
from ..parsers import ParserRegistry

# Import all parsers to register them
from ..parsers import docusaurus, mkdocs, sphinx, readthedocs, vitepress, generic  # noqa: F401


class BaseWebSpider(scrapy.Spider):
  """
  Base spider with shared parsing logic and Playwright support.

  All web scrapers inherit from this class to get:
  - Automatic parser selection based on site generator
  - Playwright integration for JS rendering
  - Job progress tracking
  - Page count limiting
  """

  name = "base_web_spider"

  def __init__(self, start_url: str, scrape_settings: ScrapySettings, job_id: str, client: Client, job_manager: JobManager, datasource_info: DataSourceInfo, *args, **kwargs):
    """
    Initialize the spider.

    Args:
        start_url: Initial URL to crawl
        scrape_settings: User-provided scraping configuration
        job_id: ID of the ingestion job
        client: RAG server client
        job_manager: Job status manager
        datasource_info: Datasource metadata
    """
    super().__init__(*args, **kwargs)

    self.start_url = start_url
    self.scrape_settings = scrape_settings
    self.job_id = job_id
    self.client = client
    self.job_manager = job_manager
    self.datasource_info = datasource_info

    self.logger_custom = get_logger(f"spider:{self.name}")
    self.pages_crawled = 0
    self.max_pages = scrape_settings.max_pages

  def start_requests(self) -> Iterator[Request]:
    """
    Generate initial requests.

    Override in subclasses for custom start behavior.
    """
    yield self._make_request(self.start_url, callback=self.parse)

  def _make_request(self, url: str, callback: Any = None, meta: Optional[dict] = None, **kwargs) -> Request:
    """
    Create a request with Playwright meta if JS rendering is enabled.

    Args:
        url: URL to request
        callback: Callback function for response
        meta: Additional meta data
        **kwargs: Additional Request arguments

    Returns:
        Scrapy Request object
    """
    request_meta = meta or {}

    # Add Playwright settings if JS rendering is enabled
    if self.scrape_settings.render_javascript:
      from ..settings import get_playwright_page_methods

      request_meta.update(
        {
          "playwright": True,
          "playwright_include_page": False,
          "playwright_page_methods": get_playwright_page_methods(self.scrape_settings),
        }
      )

    return Request(url=url, callback=callback or self.parse, meta=request_meta, errback=self.handle_error, **kwargs)

  def parse(self, response: Response) -> Iterator[ScrapedPageItem]:
    """
    Parse a response and yield scraped items.

    Args:
        response: Scrapy Response object

    Yields:
        ScrapedPageItem for each successfully parsed page
    """
    # Check page limit
    if self.pages_crawled >= self.max_pages:
      self.logger_custom.info(f"Reached max pages limit ({self.max_pages}), stopping")
      return

    self.pages_crawled += 1
    self.logger_custom.debug(f"Parsing page {self.pages_crawled}: {response.url}")

    try:
      # Use parser registry to extract content
      result = ParserRegistry.parse(response)

      yield ScrapedPageItem(
        url=response.url,
        content=result.content,
        title=result.title,
        description=result.description,
        language=result.language,
        generator=result.generator,
      )

    except Exception as e:
      self.logger_custom.error(f"Error parsing {response.url}: {e}")
      # Don't re-raise - let pipeline handle the error

  def handle_error(self, failure):
    """
    Handle request failures.

    Args:
        failure: Twisted Failure object
    """
    request = failure.request
    self.logger_custom.error(f"Request failed: {request.url} - {failure.value}")

  def should_follow_url(self, url: str) -> bool:
    """
    Check if a URL should be followed based on settings.

    Args:
        url: URL to check

    Returns:
        True if URL should be followed
    """
    import re
    from urllib.parse import urlparse

    # Check page limit
    if self.pages_crawled >= self.max_pages:
      return False

    # Check external links
    if not self.scrape_settings.follow_external_links:
      start_domain = urlparse(self.start_url).netloc
      url_domain = urlparse(url).netloc
      if url_domain != start_domain:
        return False

    # Check allowed patterns
    if self.scrape_settings.allowed_url_patterns:
      if not any(re.search(p, url) for p in self.scrape_settings.allowed_url_patterns):
        return False

    # Check denied patterns
    if self.scrape_settings.denied_url_patterns:
      if any(re.search(p, url) for p in self.scrape_settings.denied_url_patterns):
        return False

    return True
