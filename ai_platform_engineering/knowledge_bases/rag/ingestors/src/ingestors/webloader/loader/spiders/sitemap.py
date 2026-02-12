"""
Sitemap-based spider for crawling documentation sites.

Uses Scrapy's SitemapSpider to discover pages from sitemap.xml or robots.txt.
"""

import re
from typing import Iterator, Any
from urllib.parse import urlparse

from scrapy.http import Request, Response
from scrapy.spiders import SitemapSpider

from common.models.server import ScrapySettings
from common.models.rag import DataSourceInfo
from common.job_manager import JobManager
from common.ingestor import Client
from common.utils import get_logger

from ..items import ScrapedPageItem
from ..parsers import ParserRegistry

# Import all parsers to register them
from ..parsers import docusaurus, mkdocs, sphinx, readthedocs, vitepress, generic  # noqa: F401


class SitemapCrawlSpider(SitemapSpider):
  """
  Spider that crawls from sitemap.

  Uses Scrapy's built-in SitemapSpider for efficient sitemap parsing,
  including support for sitemap indexes and gzipped sitemaps.
  """

  name = "sitemap_spider"

  def __init__(self, start_url: str, scrape_settings: ScrapySettings, job_id: str, client: Client, job_manager: JobManager, datasource_info: DataSourceInfo, *args, **kwargs):
    """
    Initialize the sitemap spider.

    Args:
        start_url: Base URL or sitemap URL to crawl
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

    # Configure sitemap URLs
    # If URL ends with sitemap.xml, use it directly
    # Otherwise, try robots.txt first, then sitemap.xml
    if start_url.endswith("sitemap.xml") or start_url.endswith("sitemap.xml.gz"):
      self.sitemap_urls = [start_url]
    else:
      # SitemapSpider will check robots.txt for Sitemap: directives
      parsed = urlparse(start_url)
      base_url = f"{parsed.scheme}://{parsed.netloc}"
      self.sitemap_urls = [
        f"{base_url}/robots.txt",
        f"{base_url}/sitemap.xml",
      ]

    # Configure URL pattern filters
    if scrape_settings.allowed_url_patterns:
      self.sitemap_follow = scrape_settings.allowed_url_patterns

    super().__init__(*args, **kwargs)

  def sitemap_filter(self, entries: Iterator[dict]) -> Iterator[dict]:
    """
    Filter sitemap entries based on settings.

    Args:
        entries: Iterator of sitemap entry dicts with 'loc' key

    Yields:
        Filtered entries that should be crawled
    """
    for entry in entries:
      # Check page limit
      if self.pages_crawled >= self.max_pages:
        self.logger_custom.info(f"Reached max pages limit ({self.max_pages}), stopping sitemap processing")
        return

      url = entry.get("loc", "")

      # Check denied patterns
      if self.scrape_settings.denied_url_patterns:
        if any(re.search(p, url) for p in self.scrape_settings.denied_url_patterns):
          self.logger_custom.debug(f"Skipping denied URL: {url}")
          continue

      # Check allowed patterns (if specified)
      if self.scrape_settings.allowed_url_patterns:
        if not any(re.search(p, url) for p in self.scrape_settings.allowed_url_patterns):
          self.logger_custom.debug(f"Skipping non-matching URL: {url}")
          continue

      yield entry

  def _build_request(self, url: str, callback: Any) -> Request:
    """
    Build a request with Playwright meta if needed.

    Override SitemapSpider's method to add JS rendering support.
    """
    meta = {}

    if self.scrape_settings.render_javascript:
      from ..settings import get_playwright_page_methods

      meta.update(
        {
          "playwright": True,
          "playwright_include_page": False,
          "playwright_page_methods": get_playwright_page_methods(self.scrape_settings),
        }
      )

    return Request(url, callback=callback, meta=meta)

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
