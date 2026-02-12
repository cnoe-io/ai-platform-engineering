#!/usr/bin/env python3
"""
Scrapy worker subprocess.

This module runs in a separate process with Twisted's reactor.run() as the main loop.
It receives crawl requests via multiprocessing Queue and sends results back.

Usage:
    This module is spawned by ScrapyWorkerPool using multiprocessing.Process.
    Do not run directly.
"""

# Install Twisted reactor FIRST before any other imports
from scrapy.utils.reactor import install_reactor

install_reactor("twisted.internet.asyncioreactor.AsyncioSelectorReactor")

import hashlib
import re
import sys
import time
import traceback
from multiprocessing import Queue
from typing import List
from urllib.parse import urlparse, urljoin

from twisted.internet import reactor
from scrapy import Spider, Request
from scrapy.crawler import CrawlerRunner
from scrapy.http import Response
from scrapy.utils.log import configure_logging

from common import utils as common_utils
from common.models.server import ScrapySettings, CrawlMode

from .worker_types import (
  WorkerMessage,
  MessageType,
  CrawlRequest,
  CrawlProgress,
  CrawlResult,
  CrawlStatus,
)
from .settings import build_scrapy_settings
from .parsers import ParserRegistry

# Import all parsers to register them
from .parsers import docusaurus, mkdocs, sphinx, readthedocs, vitepress, generic  # noqa: F401


class WorkerSpider(Spider):
  """
  Generic spider that handles all crawl modes.

  This spider is configured at runtime based on the CrawlRequest.
  """

  name = "worker_spider"

  def __init__(
    self,
    request: CrawlRequest,
    result_queue: Queue,
    *args,
    **kwargs,
  ):
    super().__init__(*args, **kwargs)
    self.crawl_request = request
    self.result_queue = result_queue

    self.start_url = request.url
    self.max_pages = request.max_pages
    self.crawl_mode = request.crawl_mode
    self.follow_external = request.follow_external_links
    self.allowed_patterns = request.allowed_url_patterns or []
    self.denied_patterns = request.denied_url_patterns or []

    # Track the effective domain (may change after redirect for sitemap mode)
    self.effective_domain: str | None = None

    # Tracking
    self.pages_crawled = 0
    self.pages_failed = 0
    self.documents: List[dict] = []
    self.visited_urls: set = set()
    self.start_time = time.time()

    # Track filtering stats for better error messages
    self.urls_found_in_sitemap = 0
    self.urls_filtered_external = 0
    self.urls_filtered_pattern = 0
    self.urls_filtered_max_pages = 0

    # Collect error messages for reporting
    self.errors: list[str] = []
    self.max_errors = 50  # Limit to prevent memory issues

    # Progress tracking
    self.total_pages_to_crawl: int | None = None  # Known total (from sitemap)
    self.pending_urls: set = set()  # URLs queued but not yet crawled

    # Progress reporting
    self.last_progress_time = 0
    self.progress_interval = 2  # Report progress every 2 seconds (was 5)

  def start_requests(self):
    """Generate initial request(s) based on crawl mode."""
    # Send initial progress message for JS rendering
    if self.crawl_request.render_javascript:
      self.logger.info("JavaScript rendering enabled - starting Chromium browser")
      progress = CrawlProgress(
        job_id=self.crawl_request.job_id,
        pages_crawled=0,
        pages_failed=0,
        message="Starting Chromium browser for JavaScript rendering...",
      )
      self.result_queue.put(WorkerMessage.crawl_progress(progress).to_dict())

    if self.crawl_mode == "sitemap":
      # For sitemap mode, first try to fetch the sitemap
      parsed = urlparse(self.start_url)
      base_url = f"{parsed.scheme}://{parsed.netloc}"

      # Try sitemap.xml first
      yield Request(
        f"{base_url}/sitemap.xml",
        callback=self.parse_sitemap,
        errback=self.handle_sitemap_error,
        meta={"base_url": base_url},
      )
    else:
      # Single URL or recursive mode - start with the URL
      yield Request(self.start_url, callback=self.parse_page, errback=self.handle_error)

  def parse_sitemap(self, response: Response):
    """Parse sitemap.xml and yield requests for each URL."""
    # Update effective domain based on where we actually landed (handles redirects)
    self.effective_domain = urlparse(response.url).netloc
    self.logger.info(f"Sitemap loaded from {response.url}, effective domain: {self.effective_domain}")

    # Extract URLs from sitemap
    urls = re.findall(r"<loc>(.*?)</loc>", response.text)
    self.urls_found_in_sitemap = len(urls)

    self.logger.info(f"Found {len(urls)} URLs in sitemap")

    # Track how many URLs we'll actually crawl
    urls_to_crawl = []
    for url in urls[: self.max_pages]:
      if self._should_follow(url):
        urls_to_crawl.append(url)
        self.pending_urls.add(url)

    # Set total for progress tracking
    self.total_pages_to_crawl = len(urls_to_crawl)

    self.logger.info(f"Queued {len(urls_to_crawl)} URLs for crawling. Filtered: {self.urls_filtered_external} external, {self.urls_filtered_pattern} by pattern, {self.urls_filtered_max_pages} over max pages limit")

    # Yield requests
    for url in urls_to_crawl:
      yield Request(url, callback=self.parse_page, errback=self.handle_error)

  def handle_sitemap_error(self, failure):
    """Handle sitemap fetch failure - fall back to robots.txt."""
    base_url = failure.request.meta.get("base_url", self.start_url)
    error_msg = f"Sitemap not found, trying robots.txt: {failure.value}"
    self.logger.warning(error_msg)
    if len(self.errors) < self.max_errors:
      self.errors.append(error_msg)

    yield Request(
      f"{base_url}/robots.txt",
      callback=self.parse_robots,
      errback=self.handle_robots_error,
      meta={"base_url": base_url},
    )

  def parse_robots(self, response: Response):
    """Parse robots.txt for sitemap URLs."""
    sitemaps = re.findall(r"Sitemap:\s*(\S+)", response.text, re.IGNORECASE)

    if sitemaps:
      for sitemap_url in sitemaps:
        yield Request(sitemap_url, callback=self.parse_sitemap, errback=self.handle_error)
    else:
      # No sitemap in robots.txt, fall back to crawling the start URL
      self.logger.warning("No sitemap found in robots.txt, falling back to start URL")
      yield Request(self.start_url, callback=self.parse_page, errback=self.handle_error)

  def handle_robots_error(self, failure):
    """Handle robots.txt fetch failure."""
    error_msg = f"robots.txt not found, crawling start URL: {failure.value}"
    self.logger.warning(error_msg)
    if len(self.errors) < self.max_errors:
      self.errors.append(error_msg)
    yield Request(self.start_url, callback=self.parse_page, errback=self.handle_error)

  def parse_page(self, response: Response):
    """Parse a page and extract content."""
    # Remove from pending set
    self.pending_urls.discard(response.url)

    # Check limits
    if self.pages_crawled >= self.max_pages:
      return

    # Skip if already visited
    if response.url in self.visited_urls:
      return
    self.visited_urls.add(response.url)

    # Handle non-200 responses
    if response.status != 200:
      error_msg = f"Ignoring non-200 response ({response.status}): {response.url}"
      self.logger.warning(error_msg)
      self.pages_failed += 1
      if len(self.errors) < self.max_errors:
        self.errors.append(error_msg)
      return

    try:
      # Extract content using parser registry
      result = ParserRegistry.parse(response)

      if result.content and len(result.content.strip()) >= 10:
        # Create document
        now = int(time.time())
        # Use the system default freshness (configurable via DEFAULT_FRESH_UNTIL_SECONDS env var)
        fresh_until = common_utils.get_default_fresh_until()

        doc = {
          "id": self._generate_doc_id(response.url),
          "page_content": result.content,
          "metadata": {
            "datasource_id": self.crawl_request.datasource_id,
            "document_id": self._generate_doc_id(response.url),
            "title": result.title or "",
            "description": result.description or "",
            "document_type": "webpage",
            "document_ingested_at": now,
            "fresh_until": fresh_until,
            "ingestor_id": self.crawl_request.ingestor_id,
            "is_graph_entity": False,
            "metadata": {
              "source": response.url,
              "language": result.language or "",
              "generator": result.generator or "",
            },
          },
        }
        self.documents.append(doc)
        self.pages_crawled += 1

        self.logger.debug(f"Parsed page {self.pages_crawled}: {response.url}")
      else:
        # Skip pages with no meaningful content (redirects, images, etc.)
        # This is not an error, just nothing to extract
        self.logger.debug(f"Skipped page with no content: {response.url}")

    except Exception as e:
      error_msg = f"Error parsing {response.url}: {e}"
      self.logger.error(error_msg)
      self.pages_failed += 1
      # Collect error messages for reporting
      if len(self.errors) < self.max_errors:
        self.errors.append(error_msg)

    # Report progress periodically
    self._maybe_report_progress(response.url)

    # Follow links if in recursive mode
    if self.crawl_mode == "recursive" and self.pages_crawled < self.max_pages:
      for link in self._extract_links(response):
        if self._should_follow(link) and link not in self.pending_urls:
          self.pending_urls.add(link)
          yield Request(link, callback=self.parse_page, errback=self.handle_error)

  def handle_error(self, failure):
    """Handle request errors."""
    url = failure.request.url

    # Extract meaningful error details from the failure
    error_detail = self._get_failure_reason(failure)
    error_msg = f"{error_detail}: {url}"

    self.logger.error(error_msg)
    self.pages_failed += 1
    # Collect error messages for reporting
    if len(self.errors) < self.max_errors:
      self.errors.append(error_msg)

  def _get_failure_reason(self, failure) -> str:
    """Extract a human-readable reason from a Twisted Failure."""
    from twisted.internet.error import DNSLookupError, TimeoutError, ConnectionRefusedError, TCPTimedOutError
    from scrapy.spidermiddlewares.httperror import HttpError

    exc = failure.value

    # Check for specific exception types
    if failure.check(HttpError):
      response = exc.response
      return f"HTTP {response.status}"
    elif failure.check(DNSLookupError):
      return "DNS lookup failed"
    elif failure.check(TimeoutError, TCPTimedOutError):
      return "Connection timed out"
    elif failure.check(ConnectionRefusedError):
      return "Connection refused"
    else:
      # For other errors, use the exception class name and message
      exc_name = type(exc).__name__
      exc_msg = str(exc)
      if exc_msg and exc_msg != exc_name:
        return f"{exc_name}: {exc_msg}"
      return exc_name

  def _should_follow(self, url: str, track_filtering: bool = True) -> bool:
    """
    Check if a URL should be followed.

    Args:
        url: The URL to check
        track_filtering: If True, increment filtering counters when rejecting URLs
    """
    if url in self.visited_urls:
      return False

    if self.pages_crawled >= self.max_pages:
      if track_filtering:
        self.urls_filtered_max_pages += 1
      return False

    # Check external links
    if not self.follow_external:
      # Use effective_domain if set (e.g., after following sitemap redirect)
      # Otherwise use the original start_url domain
      if self.effective_domain:
        allowed_domain = self.effective_domain
      else:
        allowed_domain = urlparse(self.start_url).netloc

      url_domain = urlparse(url).netloc
      if url_domain != allowed_domain:
        if track_filtering:
          self.urls_filtered_external += 1
          # Log the first few for debugging
          if self.urls_filtered_external <= 3:
            self.logger.debug(f"Filtered external URL: {url} (domain {url_domain} != {allowed_domain})")
        return False

    # Check allowed patterns
    if self.allowed_patterns:
      if not any(re.search(p, url) for p in self.allowed_patterns):
        if track_filtering:
          self.urls_filtered_pattern += 1
        return False

    # Check denied patterns
    if self.denied_patterns:
      if any(re.search(p, url) for p in self.denied_patterns):
        if track_filtering:
          self.urls_filtered_pattern += 1
        return False

    return True

  def _extract_links(self, response: Response) -> List[str]:
    """Extract links from a response."""
    links = []
    for href in response.css("a::attr(href)").getall():
      # Skip anchors, javascript, mailto, etc.
      if href.startswith(("#", "javascript:", "mailto:", "tel:")):
        continue

      # Convert to absolute URL
      absolute_url = urljoin(response.url, href)

      # Only follow http/https
      if absolute_url.startswith(("http://", "https://")):
        links.append(absolute_url)

    return links

  def _generate_doc_id(self, url: str) -> str:
    """Generate a document ID from URL."""
    url_hash = hashlib.sha256(url.encode()).hexdigest()[:12]
    return f"doc_{self.crawl_request.datasource_id}_{url_hash}"

  def _maybe_report_progress(self, current_url: str):
    """Report progress if enough time has passed."""
    now = time.time()
    if now - self.last_progress_time >= self.progress_interval:
      self.last_progress_time = now

      # Build progress message based on crawl mode
      queue_size = len(self.pending_urls)
      if self.total_pages_to_crawl:
        # Sitemap mode - we know the total
        message = f"Crawling {self.pages_crawled}/{self.total_pages_to_crawl} pages"
      elif queue_size > 0:
        # Recursive mode - show queue size
        message = f"Crawling... {self.pages_crawled} pages ({queue_size} queued)"
      else:
        message = f"Crawling... {self.pages_crawled} pages"

      progress = CrawlProgress(
        job_id=self.crawl_request.job_id,
        pages_crawled=self.pages_crawled,
        pages_failed=self.pages_failed,
        current_url=current_url,
        message=message,
        total_pages=self.total_pages_to_crawl,
        queue_size=queue_size,
      )
      self.result_queue.put(WorkerMessage.crawl_progress(progress).to_dict())

  def closed(self, reason):
    """Called when spider closes."""
    elapsed = time.time() - self.start_time

    # Determine status and build fatal error message
    fatal_error = None
    if self.pages_crawled == 0:
      status = CrawlStatus.FAILED
      # Build detailed error message explaining why no pages were crawled
      fatal_error = self._build_failure_message()
    elif self.pages_failed > 0:
      status = CrawlStatus.PARTIAL
    else:
      status = CrawlStatus.SUCCESS

    result = CrawlResult(
      job_id=self.crawl_request.job_id,
      status=status,
      pages_crawled=self.pages_crawled,
      pages_failed=self.pages_failed,
      documents=self.documents,
      elapsed_seconds=elapsed,
      fatal_error=fatal_error,
      errors=self.errors,
      # Include filtering stats for debugging
      urls_found_in_sitemap=self.urls_found_in_sitemap,
      urls_filtered_external=self.urls_filtered_external,
      urls_filtered_pattern=self.urls_filtered_pattern,
      urls_filtered_max_pages=self.urls_filtered_max_pages,
    )

    self.result_queue.put(WorkerMessage.crawl_result(result).to_dict())
    self.logger.info(f"Spider closed: {reason}, crawled {self.pages_crawled} pages in {elapsed:.1f}s")

  def _build_failure_message(self) -> str:
    """Build a detailed message explaining why the crawl failed."""
    parts = []

    # Check if this was a sitemap crawl that found URLs but none were followed
    if self.urls_found_in_sitemap > 0:
      parts.append(f"Found {self.urls_found_in_sitemap} URLs in sitemap but 0 were scraped.")

      filter_details = []
      if self.urls_filtered_external > 0:
        original_domain = urlparse(self.start_url).netloc
        effective = self.effective_domain or original_domain
        if original_domain != effective:
          filter_details.append(f"{self.urls_filtered_external} filtered as external (sitemap domain '{effective}' differs from start URL domain '{original_domain}')")
        else:
          filter_details.append(f"{self.urls_filtered_external} filtered as external links")

      if self.urls_filtered_pattern > 0:
        filter_details.append(f"{self.urls_filtered_pattern} filtered by URL patterns")

      if self.urls_filtered_max_pages > 0:
        filter_details.append(f"{self.urls_filtered_max_pages} filtered by max pages limit ({self.max_pages})")

      if filter_details:
        parts.append("Filtering breakdown: " + "; ".join(filter_details) + ".")

      # Suggest fix for domain mismatch
      if self.urls_filtered_external > 0 and self.effective_domain:
        original_domain = urlparse(self.start_url).netloc
        if original_domain != self.effective_domain:
          parts.append(f"Tip: The site redirects from '{original_domain}' to '{self.effective_domain}'. Try using 'https://{self.effective_domain}' as the start URL, or enable 'Follow external links' to allow cross-domain crawling.")
    else:
      # Generic failure message
      parts.append("No pages were crawled.")
      if self.pages_failed > 0:
        parts.append(f"{self.pages_failed} requests failed.")

    # Include collected error messages for more detail
    if self.errors:
      parts.append("Errors: " + "; ".join(self.errors[:5]))  # Show first 5 errors
      if len(self.errors) > 5:
        parts.append(f"(and {len(self.errors) - 5} more)")

    return " ".join(parts)


def build_spider_settings(request: CrawlRequest) -> dict:
  """Build Scrapy settings from a CrawlRequest."""
  # Convert to ScrapySettings
  settings = ScrapySettings(
    crawl_mode=CrawlMode(request.crawl_mode),
    max_depth=request.max_depth,
    max_pages=request.max_pages,
    render_javascript=request.render_javascript,
    wait_for_selector=request.wait_for_selector,
    page_load_timeout=request.page_load_timeout,
    follow_external_links=request.follow_external_links,
    allowed_url_patterns=request.allowed_url_patterns,
    denied_url_patterns=request.denied_url_patterns,
    download_delay=request.download_delay,
    concurrent_requests=request.concurrent_requests,
    respect_robots_txt=request.respect_robots_txt,
    user_agent=request.user_agent,
  )

  return build_scrapy_settings(settings)


def run_crawl(request: CrawlRequest, result_queue: Queue):
  """
  Run a single crawl using Scrapy.

  This function sets up the CrawlerRunner and runs the spider.
  """
  # Build settings
  scrapy_settings = build_spider_settings(request)

  # Configure logging
  configure_logging({"LOG_LEVEL": "INFO"})

  # Create runner
  runner = CrawlerRunner(settings=scrapy_settings)

  # Run spider
  deferred = runner.crawl(WorkerSpider, request=request, result_queue=result_queue)

  return deferred


def worker_main(worker_id: int, request_queue: Queue, result_queue: Queue):
  """
  Main entry point for worker subprocess.

  This function runs the Twisted reactor and processes crawl requests.

  Args:
      worker_id: Unique ID for this worker
      request_queue: Queue to receive crawl requests from
      result_queue: Queue to send results back to main process
  """
  print(f"[Worker {worker_id}] Starting...")

  # Signal that we're ready
  result_queue.put(WorkerMessage.worker_ready(worker_id).to_dict())

  def check_queue():
    """Check for new requests in the queue."""
    try:
      # Non-blocking check
      if not request_queue.empty():
        msg_dict = request_queue.get_nowait()
        msg = WorkerMessage.from_dict(msg_dict)

        if msg.type == MessageType.SHUTDOWN:
          print(f"[Worker {worker_id}] Received shutdown signal")
          reactor.stop()
          return

        if msg.type == MessageType.CRAWL_REQUEST:
          # Parse request
          request = CrawlRequest(**msg.payload)
          print(f"[Worker {worker_id}] Starting crawl: {request.url}")

          # Signal crawl started
          result_queue.put(WorkerMessage.crawl_started(request.job_id).to_dict())

          # Run the crawl
          d = run_crawl(request, result_queue)

          # When done, check for more work
          d.addCallback(lambda _: reactor.callLater(0.1, check_queue))
          d.addErrback(lambda f: handle_crawl_error(f, request.job_id, result_queue))
          return

    except Exception as e:
      print(f"[Worker {worker_id}] Error checking queue: {e}")
      traceback.print_exc()

    # Schedule next check
    reactor.callLater(0.5, check_queue)

  def handle_crawl_error(failure, job_id: str, result_queue: Queue):
    """Handle crawl errors."""
    error_msg = str(failure.value)
    print(f"[Worker {worker_id}] Crawl error: {error_msg}")

    result = CrawlResult(
      job_id=job_id,
      status=CrawlStatus.FAILED,
      pages_crawled=0,
      pages_failed=0,
      fatal_error=error_msg,
    )
    result_queue.put(WorkerMessage.crawl_result(result).to_dict())

    # Continue checking for more work
    reactor.callLater(0.1, check_queue)

  # Start checking queue after reactor starts
  reactor.callWhenRunning(check_queue)

  # Run the reactor - this blocks until reactor.stop() is called
  try:
    reactor.run(installSignalHandlers=False)
  except Exception as e:
    print(f"[Worker {worker_id}] Reactor error: {e}")
    result_queue.put(WorkerMessage.worker_error(str(e)).to_dict())

  print(f"[Worker {worker_id}] Exiting")


if __name__ == "__main__":
  # This should not be run directly - it's spawned by ScrapyWorkerPool
  print("This module should be spawned by ScrapyWorkerPool, not run directly")
  sys.exit(1)
