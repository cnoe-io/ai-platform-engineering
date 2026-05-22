"""
Integration tests that run actual Scrapy crawls against a live site.

These tests verify end-to-end crawling works correctly after dependency
upgrades (Scrapy, Twisted, etc.). They catch issues like:
- Scrapy 2.16 start() vs start_requests() entry point changes
- Twisted TLS/SSL incompatibilities
- Spider attribute validation changes

Requirements:
- Network access to https://caipe.io
- Run with: uv run pytest tests/webloader/test_crawl_integration.py -v

These tests are marked with @pytest.mark.integration so they can be
skipped in CI environments without network access.
"""

import json
import subprocess
import sys
import textwrap

import pytest

# Target site for integration tests
TARGET_URL = "https://caipe.io"
MAX_PAGES = 5


def _run_crawl(crawl_mode: str, render_javascript: bool = False, url: str = TARGET_URL):
  """
  Run a Scrapy crawl in a subprocess and return parsed results.

  Uses a subprocess to avoid Twisted reactor restart issues in pytest.
  The subprocess runs the crawl and prints JSON results to stdout.
  """
  script = textwrap.dedent(f"""\
    import json, sys, time
    from multiprocessing import Queue

    from scrapy.utils.reactor import install_reactor
    install_reactor("twisted.internet.asyncioreactor.AsyncioSelectorReactor")

    from twisted.internet import reactor
    from scrapy.crawler import CrawlerRunner
    from scrapy.utils.log import configure_logging

    from ingestors.webloader.loader.scrapy_worker import WorkerSpider, build_spider_settings
    from ingestors.webloader.loader.worker_types import (
      CrawlRequest, CrawlResult, CrawlStatus, WorkerMessage, MessageType,
    )

    configure_logging({{"LOG_LEVEL": "WARNING"}})

    request = CrawlRequest(
      job_id="integration-test-{crawl_mode}",
      url="{url}",
      datasource_id="test-integration",
      ingestor_id="test-ingestor",
      crawl_mode="{crawl_mode}",
      max_pages={MAX_PAGES},
      max_depth=2,
      render_javascript={render_javascript},
      follow_external_links=False,
      respect_robots_txt=True,
      download_delay=0.1,
      concurrent_requests=5,
      page_load_timeout=15,
    )

    result_queue = Queue()
    settings = build_spider_settings(request)
    runner = CrawlerRunner(settings=settings)

    d = runner.crawl(WorkerSpider, request=request, result_queue=result_queue)
    d.addBoth(lambda _: reactor.stop())
    reactor.run(installSignalHandlers=False)

    # Collect results
    result = None
    documents = []
    while not result_queue.empty():
      msg_dict = result_queue.get_nowait()
      msg = WorkerMessage.from_dict(msg_dict)
      if msg.type == MessageType.CRAWL_RESULT:
        result = msg.payload
      elif msg.type == MessageType.CRAWL_DOCUMENTS:
        documents.extend(msg.payload.get("documents", []))

    output = {{
      "result": result,
      "document_count": len(documents),
    }}
    print("CRAWL_RESULT:" + json.dumps(output))
  """)

  proc = subprocess.run(
    [sys.executable, "-c", script],
    capture_output=True,
    text=True,
    timeout=60,
    cwd=str(__import__("pathlib").Path(__file__).parents[2] / "src"),
  )

  # Parse result from stdout
  for line in proc.stdout.splitlines():
    if line.startswith("CRAWL_RESULT:"):
      data = json.loads(line[len("CRAWL_RESULT:") :])
      return data["result"], data["document_count"]

  # If no result found, fail with stderr
  raise AssertionError(f"Crawl subprocess failed to produce results.\nreturncode={proc.returncode}\nstderr (last 500 chars)={proc.stderr[-500:]}\nstdout (last 500 chars)={proc.stdout[-500:]}")


@pytest.mark.integration
class TestCrawlIntegration:
  """Integration tests that perform actual crawls against caipe.io."""

  def test_single_mode(self):
    """Single URL mode should crawl exactly 1 page."""
    result, doc_count = _run_crawl("single")

    assert result is not None, "No CrawlResult received"
    assert result["status"] in ("success", "partial"), f"Crawl failed: {result.get('fatal_error')}"
    assert result["pages_crawled"] >= 1, f"Expected at least 1 page, got {result['pages_crawled']}"
    assert doc_count >= 1, f"Expected at least 1 document, got {doc_count}"

  def test_sitemap_mode(self):
    """Sitemap mode should discover and crawl pages from sitemap.xml."""
    result, doc_count = _run_crawl("sitemap")

    assert result is not None, "No CrawlResult received"
    assert result["status"] in ("success", "partial"), f"Crawl failed: {result.get('fatal_error')}"
    assert result["pages_crawled"] >= 1, f"Expected at least 1 page from sitemap, got {result['pages_crawled']}"
    assert doc_count >= 1, f"Expected at least 1 document, got {doc_count}"

  def test_recursive_mode(self):
    """Recursive mode should follow links and crawl multiple pages."""
    result, doc_count = _run_crawl("recursive")

    assert result is not None, "No CrawlResult received"
    assert result["status"] in ("success", "partial"), f"Crawl failed: {result.get('fatal_error')}"
    assert result["pages_crawled"] >= 2, f"Expected at least 2 pages in recursive mode, got {result['pages_crawled']}"
    assert doc_count >= 2, f"Expected at least 2 documents, got {doc_count}"
