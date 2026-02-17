"""
Single URL spider for scraping a single page.

The simplest spider - just fetches and parses one URL.
"""

from typing import Iterator
from scrapy.http import Request

from .base import BaseWebSpider


class SingleUrlSpider(BaseWebSpider):
  """
  Spider that scrapes a single URL.

  This is the default spider when crawl_mode is 'single'.
  It simply fetches the provided URL and extracts content.
  """

  name = "single_url_spider"

  def start_requests(self) -> Iterator[Request]:
    """Generate a single request for the start URL."""
    self.logger_custom.info(f"Starting single URL scrape: {self.start_url}")
    yield self._make_request(self.start_url, callback=self.parse)
