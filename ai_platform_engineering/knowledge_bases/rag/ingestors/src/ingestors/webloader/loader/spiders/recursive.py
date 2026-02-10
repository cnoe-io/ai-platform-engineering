"""
Recursive crawl spider for following links.

Uses Scrapy's CrawlSpider with LinkExtractor for discovering pages
by following links from the start URL.
"""

import re
from typing import Iterator, Set
from urllib.parse import urlparse

from scrapy.http import Request, Response
from scrapy.spiders import CrawlSpider, Rule
from scrapy.linkextractors import LinkExtractor

from common.models.server import ScrapySettings
from common.models.rag import DataSourceInfo
from common.job_manager import JobManager
from common.ingestor import Client
from common.utils import get_logger

from ..items import ScrapedPageItem
from ..parsers import ParserRegistry

# Import all parsers to register them
from ..parsers import docusaurus, mkdocs, sphinx, readthedocs, vitepress, generic  # noqa: F401


class RecursiveCrawlSpider(CrawlSpider):
  """
  Spider that follows links recursively.

  Uses Scrapy's CrawlSpider with configurable rules for
  discovering and following links.
  """

  name = "recursive_spider"

  def __init__(self, start_url: str, scrape_settings: ScrapySettings, job_id: str, client: Client, job_manager: JobManager, datasource_info: DataSourceInfo, *args, **kwargs):
    """
    Initialize the recursive spider.

    Args:
        start_url: Initial URL to start crawling from
        scrape_settings: User-provided scraping configuration
        job_id: ID of the ingestion job
        client: RAG server client
        job_manager: Job status manager
        datasource_info: Datasource metadata
    """
    self.start_url = start_url
    self.scrape_settings = scrape_settings
    self.job_id = job_id
    self.client = client
    self.job_manager = job_manager
    self.datasource_info = datasource_info

    self.logger_custom = get_logger(f"spider:{self.name}")
    self.pages_crawled = 0
    self.max_pages = scrape_settings.max_pages
    self.visited_urls: Set[str] = set()

    # Set start URLs
    self.start_urls = [start_url]

    # Set allowed domains
    parsed = urlparse(start_url)
    if scrape_settings.follow_external_links:
      self.allowed_domains = []  # Allow all domains
    else:
      self.allowed_domains = [parsed.netloc]

    # Build link extractor with URL patterns
    link_extractor = LinkExtractor(
      allow=scrape_settings.allowed_url_patterns or (),
      deny=scrape_settings.denied_url_patterns or (),
      allow_domains=self.allowed_domains if self.allowed_domains else None,
      deny_extensions=[
        "png",
        "jpg",
        "jpeg",
        "gif",
        "svg",
        "ico",
        "webp",  # Images
        "pdf",
        "doc",
        "docx",
        "xls",
        "xlsx",
        "ppt",
        "pptx",  # Documents
        "zip",
        "tar",
        "gz",
        "rar",  # Archives
        "mp3",
        "mp4",
        "avi",
        "mov",
        "wmv",  # Media
        "css",
        "js",
        "woff",
        "woff2",
        "ttf",
        "eot",  # Assets
      ],
    )

    # Set up rules for following links
    self.rules = (
      Rule(
        link_extractor,
        callback="parse_page",
        follow=True,
        process_request="process_request",
      ),
    )

    super().__init__(*args, **kwargs)

  def start_requests(self) -> Iterator[Request]:
    """Generate initial requests with Playwright support."""
    for url in self.start_urls:
      yield self._make_request(url, callback=self.parse_page)

  def _make_request(self, url: str, callback=None, **kwargs) -> Request:
    """
    Create a request with Playwright meta if needed.

    Args:
        url: URL to request
        callback: Callback function
        **kwargs: Additional request arguments

    Returns:
        Scrapy Request object
    """
    meta = kwargs.pop("meta", {})

    if self.scrape_settings.render_javascript:
      from ..settings import get_playwright_page_methods

      meta.update(
        {
          "playwright": True,
          "playwright_include_page": False,
          "playwright_page_methods": get_playwright_page_methods(self.scrape_settings),
        }
      )

    return Request(url, callback=callback or self.parse_page, meta=meta, **kwargs)

  def process_request(self, request: Request, response: Response) -> Request | None:
    """
    Process each request before sending.

    Used to add Playwright settings and check limits.

    Args:
        request: The request to process
        response: The response that generated this request

    Returns:
        Modified request or None to skip
    """
    # Check page limit
    if self.pages_crawled >= self.max_pages:
      return None

    # Check if already visited
    if request.url in self.visited_urls:
      return None

    # Add Playwright settings if needed
    if self.scrape_settings.render_javascript:
      from ..settings import get_playwright_page_methods

      request.meta.update(
        {
          "playwright": True,
          "playwright_include_page": False,
          "playwright_page_methods": get_playwright_page_methods(self.scrape_settings),
        }
      )

    return request

  def parse_page(self, response: Response) -> Iterator[ScrapedPageItem]:
    """
    Parse a response and yield scraped items.

    Args:
        response: Scrapy Response object

    Yields:
        ScrapedPageItem for each successfully parsed page
    """
    # Check page limit
    if self.pages_crawled >= self.max_pages:
      return

    # Track visited URLs
    if response.url in self.visited_urls:
      return
    self.visited_urls.add(response.url)

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
