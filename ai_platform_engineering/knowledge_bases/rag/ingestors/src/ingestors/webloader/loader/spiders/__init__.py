"""
Scrapy spiders for web scraping.

This package contains spiders for different crawling modes:
- SingleUrlSpider: Scrape a single URL
- SitemapCrawlSpider: Crawl using sitemap
- RecursiveCrawlSpider: Follow links recursively
"""

from .base import BaseWebSpider
from .single_url import SingleUrlSpider
from .sitemap import SitemapCrawlSpider
from .recursive import RecursiveCrawlSpider

__all__ = [
  "BaseWebSpider",
  "SingleUrlSpider",
  "SitemapCrawlSpider",
  "RecursiveCrawlSpider",
]
