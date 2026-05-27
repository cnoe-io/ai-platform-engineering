"""
Simple tests for the Scrapy spiders.

These tests verify spider initialization, URL filtering logic,
and basic request generation without running actual crawls.
"""

from unittest.mock import Mock


# ============================================================================
# Mock Objects for Testing
# ============================================================================


def make_mock_settings(
  crawl_mode: str = "single",
  max_pages: int = 100,
  max_depth: int = 2,
  render_javascript: bool = False,
  follow_external_links: bool = False,
  allowed_url_patterns: list = None,
  denied_url_patterns: list = None,
):
  """Create a mock ScrapySettings object."""
  mock = Mock()
  mock.crawl_mode = crawl_mode
  mock.max_pages = max_pages
  mock.max_depth = max_depth
  mock.render_javascript = render_javascript
  mock.follow_external_links = follow_external_links
  mock.allowed_url_patterns = allowed_url_patterns
  mock.denied_url_patterns = denied_url_patterns
  mock.wait_for_selector = None
  mock.page_load_timeout = 30
  return mock


def make_mock_client():
  """Create a mock RAG Client."""
  return Mock()


def make_mock_job_manager():
  """Create a mock JobManager."""
  return Mock()


def make_mock_datasource_info():
  """Create a mock DataSourceInfo."""
  mock = Mock()
  mock.datasource_id = "test-datasource-123"
  return mock


# ============================================================================
# ScrapedPageItem Tests
# ============================================================================


class TestScrapedPageItem:
  """Tests for the ScrapedPageItem dataclass."""

  def test_item_creation(self):
    """Should create an item with required fields."""
    from ingestors.webloader.loader.items import ScrapedPageItem

    item = ScrapedPageItem(
      url="https://example.com/page",
      content="This is the page content.",
    )

    assert item.url == "https://example.com/page"
    assert item.content == "This is the page content."
    assert item.title == ""  # Default
    assert item.description == ""  # Default

  def test_item_with_metadata(self):
    """Should create an item with all metadata fields."""
    from ingestors.webloader.loader.items import ScrapedPageItem

    item = ScrapedPageItem(
      url="https://example.com/docs",
      content="Documentation content",
      title="My Docs",
      description="Documentation description",
      language="en",
      generator="Docusaurus v2.4",
    )

    assert item.title == "My Docs"
    assert item.description == "Documentation description"
    assert item.language == "en"
    assert item.generator == "Docusaurus v2.4"

  def test_item_to_dict(self):
    """Should convert item to dictionary."""
    from ingestors.webloader.loader.items import ScrapedPageItem

    item = ScrapedPageItem(
      url="https://example.com",
      content="Content",
      title="Title",
    )

    result = item.to_dict()

    assert isinstance(result, dict)
    assert result["url"] == "https://example.com"
    assert result["content"] == "Content"
    assert result["title"] == "Title"


# ============================================================================
# URL Filtering Tests
# ============================================================================


class TestUrlFiltering:
  """Tests for URL filtering logic in spiders."""

  def test_blocks_external_links_by_default(self):
    """Spider should block external links when follow_external_links=False."""
    from ingestors.webloader.loader.spiders.base import BaseWebSpider

    spider = BaseWebSpider(
      start_url="https://docs.example.com/guide",
      scrape_settings=make_mock_settings(follow_external_links=False),
      job_id="test-job",
      client=make_mock_client(),
      job_manager=make_mock_job_manager(),
      datasource_info=make_mock_datasource_info(),
    )

    # Same domain should be allowed
    assert spider.should_follow_url("https://docs.example.com/other-page") is True

    # Different domain should be blocked
    assert spider.should_follow_url("https://other-site.com/page") is False

  def test_allows_external_links_when_enabled(self):
    """Spider should allow external links when follow_external_links=True."""
    from ingestors.webloader.loader.spiders.base import BaseWebSpider

    spider = BaseWebSpider(
      start_url="https://docs.example.com/guide",
      scrape_settings=make_mock_settings(follow_external_links=True),
      job_id="test-job",
      client=make_mock_client(),
      job_manager=make_mock_job_manager(),
      datasource_info=make_mock_datasource_info(),
    )

    assert spider.should_follow_url("https://other-site.com/page") is True

  def test_respects_allowed_patterns(self):
    """Spider should only follow URLs matching allowed patterns."""
    from ingestors.webloader.loader.spiders.base import BaseWebSpider

    spider = BaseWebSpider(
      start_url="https://docs.example.com/",
      scrape_settings=make_mock_settings(allowed_url_patterns=[r"/docs/", r"/api/"]),
      job_id="test-job",
      client=make_mock_client(),
      job_manager=make_mock_job_manager(),
      datasource_info=make_mock_datasource_info(),
    )

    # Matches /docs/
    assert spider.should_follow_url("https://docs.example.com/docs/getting-started") is True
    # Matches /api/
    assert spider.should_follow_url("https://docs.example.com/api/reference") is True
    # Doesn't match any pattern
    assert spider.should_follow_url("https://docs.example.com/blog/post") is False

  def test_respects_denied_patterns(self):
    """Spider should skip URLs matching denied patterns."""
    from ingestors.webloader.loader.spiders.base import BaseWebSpider

    spider = BaseWebSpider(
      start_url="https://docs.example.com/",
      scrape_settings=make_mock_settings(denied_url_patterns=[r"/blog/", r"\.pdf$"]),
      job_id="test-job",
      client=make_mock_client(),
      job_manager=make_mock_job_manager(),
      datasource_info=make_mock_datasource_info(),
    )

    # Should be blocked by /blog/ pattern
    assert spider.should_follow_url("https://docs.example.com/blog/post") is False
    # Should be blocked by .pdf pattern
    assert spider.should_follow_url("https://docs.example.com/files/doc.pdf") is False
    # Should be allowed
    assert spider.should_follow_url("https://docs.example.com/docs/page") is True

  def test_respects_max_pages_limit(self):
    """Spider should stop following URLs when max_pages is reached."""
    from ingestors.webloader.loader.spiders.base import BaseWebSpider

    spider = BaseWebSpider(
      start_url="https://docs.example.com/",
      scrape_settings=make_mock_settings(max_pages=10),
      job_id="test-job",
      client=make_mock_client(),
      job_manager=make_mock_job_manager(),
      datasource_info=make_mock_datasource_info(),
    )

    # Initially should allow
    assert spider.should_follow_url("https://docs.example.com/page") is True

    # Simulate reaching max pages
    spider.pages_crawled = 10

    # Should now block
    assert spider.should_follow_url("https://docs.example.com/page") is False


# ============================================================================
# Spider Initialization Tests
# ============================================================================


class TestSpiderInitialization:
  """Tests for spider initialization."""

  def test_base_spider_stores_settings(self):
    """Base spider should store all provided settings."""
    from ingestors.webloader.loader.spiders.base import BaseWebSpider

    settings = make_mock_settings(max_pages=500)
    client = make_mock_client()
    job_manager = make_mock_job_manager()
    datasource_info = make_mock_datasource_info()

    spider = BaseWebSpider(
      start_url="https://example.com",
      scrape_settings=settings,
      job_id="test-123",
      client=client,
      job_manager=job_manager,
      datasource_info=datasource_info,
    )

    assert spider.start_url == "https://example.com"
    assert spider.job_id == "test-123"
    assert spider.max_pages == 500
    assert spider.pages_crawled == 0

  def test_single_url_spider_name(self):
    """SingleUrlSpider should have correct name."""
    from ingestors.webloader.loader.spiders.single_url import SingleUrlSpider

    spider = SingleUrlSpider(
      start_url="https://example.com",
      scrape_settings=make_mock_settings(),
      job_id="test",
      client=make_mock_client(),
      job_manager=make_mock_job_manager(),
      datasource_info=make_mock_datasource_info(),
    )

    assert spider.name == "single_url_spider"

  def test_sitemap_spider_name(self):
    """SitemapCrawlSpider should have correct name."""
    from ingestors.webloader.loader.spiders.sitemap import SitemapCrawlSpider

    spider = SitemapCrawlSpider(
      start_url="https://example.com",
      scrape_settings=make_mock_settings(),
      job_id="test",
      client=make_mock_client(),
      job_manager=make_mock_job_manager(),
      datasource_info=make_mock_datasource_info(),
    )

    assert spider.name == "sitemap_spider"

  def test_recursive_spider_name(self):
    """RecursiveCrawlSpider should have correct name."""
    from ingestors.webloader.loader.spiders.recursive import RecursiveCrawlSpider

    spider = RecursiveCrawlSpider(
      start_url="https://example.com",
      scrape_settings=make_mock_settings(),
      job_id="test",
      client=make_mock_client(),
      job_manager=make_mock_job_manager(),
      datasource_info=make_mock_datasource_info(),
    )

    assert spider.name == "recursive_spider"


# ============================================================================
# WorkerSpider Redirect Handling Tests
# ============================================================================


class TestWorkerSpiderRedirectHandling:
  """Tests for WorkerSpider handling of URL redirects in recursive mode."""

  def _make_worker_spider(
    self,
    start_url: str = "https://original.com",
    crawl_mode: str = "recursive",
    follow_external: bool = False,
  ):
    """Create a WorkerSpider instance for testing."""
    from ingestors.webloader.loader.scrapy_worker import WorkerSpider
    from ingestors.webloader.loader.worker_types import CrawlRequest
    from multiprocessing import Queue

    request = CrawlRequest(
      job_id="test-job",
      url=start_url,
      datasource_id="test-ds",
      crawl_mode=crawl_mode,
      follow_external_links=follow_external,
      max_pages=100,
    )
    result_queue = Queue()

    spider = WorkerSpider(request=request, result_queue=result_queue)
    return spider

  def test_effective_domain_initially_none(self):
    """WorkerSpider should have effective_domain=None initially."""
    spider = self._make_worker_spider()
    assert spider.effective_domain is None

  def test_should_follow_uses_start_domain_when_no_redirect(self):
    """Without redirect, _should_follow should use start_url domain."""
    spider = self._make_worker_spider(start_url="https://docs.example.com")

    # Same domain should be allowed
    assert spider._should_follow("https://docs.example.com/page1", track_filtering=False) is True

    # Different domain should be blocked
    assert spider._should_follow("https://other.com/page", track_filtering=False) is False

  def test_should_follow_uses_effective_domain_after_redirect(self):
    """After redirect, _should_follow should use effective_domain."""
    spider = self._make_worker_spider(start_url="https://original.com")

    # Simulate a redirect by setting effective_domain (as parse_page would)
    spider.effective_domain = "redirected.com"

    # Link on redirected domain should be allowed
    assert spider._should_follow("https://redirected.com/page", track_filtering=False) is True

    # Link on original domain should now be blocked (it's external to where we are)
    assert spider._should_follow("https://original.com/page", track_filtering=False) is False

  def test_parse_page_sets_effective_domain_on_redirect(self):
    """parse_page should set effective_domain when response URL differs from start_url."""
    spider = self._make_worker_spider(start_url="https://caipe.io")

    # Create a mock response that simulates landing on a different domain after redirect
    mock_response = Mock()
    mock_response.url = "https://cnoe-io.github.io/ai-platform-engineering/"
    mock_response.status = 200
    mock_response.text = "<html><body>Content</body></html>"
    mock_response.css = Mock(return_value=Mock(getall=Mock(return_value=[])))

    # Initially effective_domain should be None
    assert spider.effective_domain is None

    # Consume the generator (parse_page is a generator due to yield statements)
    list(spider.parse_page(mock_response))

    # After parse_page, effective_domain should be set to the response domain
    assert spider.effective_domain == "cnoe-io.github.io"

  def test_parse_page_does_not_change_effective_domain_if_same(self):
    """parse_page should not set effective_domain if response domain matches start domain."""
    spider = self._make_worker_spider(start_url="https://docs.example.com")

    mock_response = Mock()
    mock_response.url = "https://docs.example.com/page"
    mock_response.status = 200
    mock_response.text = "<html><body>Content</body></html>"
    mock_response.css = Mock(return_value=Mock(getall=Mock(return_value=[])))

    # Consume the generator
    list(spider.parse_page(mock_response))

    # effective_domain should remain None since no redirect occurred
    assert spider.effective_domain is None

  def test_caipe_io_redirect_scenario(self):
    """Simulate the caipe.io -> cnoe-io.github.io redirect scenario."""
    spider = self._make_worker_spider(start_url="https://caipe.io", crawl_mode="recursive")

    # Before any redirect handling
    # A link to github.io should be blocked (external)
    assert spider._should_follow("https://cnoe-io.github.io/ai-platform-engineering/docs/", track_filtering=False) is False

    # Simulate parse_page detecting the redirect
    spider.effective_domain = "cnoe-io.github.io"

    # Now the same link should be allowed
    assert spider._should_follow("https://cnoe-io.github.io/ai-platform-engineering/docs/", track_filtering=False) is True

    # Links to original domain should now be blocked
    assert spider._should_follow("https://caipe.io/some-page", track_filtering=False) is False


# ============================================================================
# WorkerSpider Streaming and Cancellation Tests
# ============================================================================


class TestWorkerSpiderStreaming:
  """Tests for WorkerSpider batch streaming functionality."""

  def _make_worker_spider(
    self,
    start_url: str = "https://example.com",
    crawl_mode: str = "recursive",
    max_pages: int = 100,
  ):
    """Create a WorkerSpider instance for testing."""
    from ingestors.webloader.loader.scrapy_worker import WorkerSpider
    from ingestors.webloader.loader.worker_types import CrawlRequest
    from multiprocessing import Queue

    request = CrawlRequest(
      job_id="test-job",
      url=start_url,
      datasource_id="test-ds",
      crawl_mode=crawl_mode,
      max_pages=max_pages,
    )
    result_queue = Queue()

    spider = WorkerSpider(request=request, result_queue=result_queue)
    return spider

  def test_spider_has_batch_size_setting(self):
    """WorkerSpider should have a batch_size setting."""
    spider = self._make_worker_spider()
    # batch_size should be set to a reasonable default
    assert hasattr(spider, "batch_size")
    assert spider.batch_size > 0

  def test_spider_has_cancelled_flag(self):
    """WorkerSpider should have a _cancelled flag."""
    spider = self._make_worker_spider()
    assert hasattr(spider, "_cancelled")
    assert spider._cancelled is False

  def test_cancel_sets_flag(self):
    """cancel() should set the _cancelled flag."""
    spider = self._make_worker_spider()

    spider.cancel()

    assert spider._cancelled is True

  def test_document_batch_tracking(self):
    """WorkerSpider should track documents in batches."""
    spider = self._make_worker_spider()
    # Should have document batch list and counter
    assert hasattr(spider, "documents_in_current_batch")
    assert hasattr(spider, "batch_number")
    assert spider.batch_number == 0


class TestWorkerSpiderCancellation:
  """Tests for WorkerSpider cancellation during crawl."""

  def _make_worker_spider(self, start_url: str = "https://example.com"):
    """Create a WorkerSpider instance for testing."""
    from ingestors.webloader.loader.scrapy_worker import WorkerSpider
    from ingestors.webloader.loader.worker_types import CrawlRequest
    from multiprocessing import Queue

    request = CrawlRequest(
      job_id="test-job",
      url=start_url,
      datasource_id="test-ds",
      crawl_mode="recursive",
      max_pages=100,
    )
    result_queue = Queue()

    spider = WorkerSpider(request=request, result_queue=result_queue)
    return spider

  def test_parse_page_exits_early_when_cancelled(self):
    """parse_page should exit early if spider is cancelled."""
    spider = self._make_worker_spider()

    # Set cancelled flag
    spider._cancelled = True

    # Create a mock response
    mock_response = Mock()
    mock_response.url = "https://example.com/page"
    mock_response.status = 200
    mock_response.text = "<html><body>Content</body></html>"

    # parse_page should yield nothing when cancelled
    results = list(spider.parse_page(mock_response))

    # Should be empty (no documents, no follow links)
    assert len(results) == 0


class TestCrawlDocumentsMessage:
  """Tests for CrawlDocuments message type."""

  def test_crawl_documents_creation(self):
    """CrawlDocuments should store batch info correctly."""
    from ingestors.webloader.loader.worker_types import CrawlDocuments

    docs = CrawlDocuments(
      job_id="test-job",
      documents=[{"id": "doc1", "page_content": "content", "metadata": {}}],
      batch_number=1,
      is_final_batch=False,
    )

    assert docs.job_id == "test-job"
    assert len(docs.documents) == 1
    assert docs.batch_number == 1
    assert docs.is_final_batch is False

  def test_crawl_documents_final_batch(self):
    """CrawlDocuments should track final batch correctly."""
    from ingestors.webloader.loader.worker_types import CrawlDocuments

    docs = CrawlDocuments(
      job_id="test-job",
      documents=[],
      batch_number=5,
      is_final_batch=True,
    )

    assert docs.is_final_batch is True


class TestWorkerMessageCancelCrawl:
  """Tests for CANCEL_CRAWL message type."""

  def test_cancel_crawl_message_creation(self):
    """WorkerMessage.cancel_crawl should create correct message."""
    from ingestors.webloader.loader.worker_types import WorkerMessage, MessageType

    msg = WorkerMessage.cancel_crawl("job-123")

    assert msg.type == MessageType.CANCEL_CRAWL
    assert msg.payload["job_id"] == "job-123"

  def test_cancel_crawl_message_serialization(self):
    """CANCEL_CRAWL message should serialize/deserialize correctly."""
    from ingestors.webloader.loader.worker_types import WorkerMessage, MessageType

    msg = WorkerMessage.cancel_crawl("job-456")
    msg_dict = msg.to_dict()

    # Should serialize to dict
    assert msg_dict["type"] == "cancel_crawl"
    assert msg_dict["payload"]["job_id"] == "job-456"

    # Should deserialize back
    restored = WorkerMessage.from_dict(msg_dict)
    assert restored.type == MessageType.CANCEL_CRAWL
    assert restored.payload["job_id"] == "job-456"


class TestWorkerMessageCrawlDocuments:
  """Tests for CRAWL_DOCUMENTS message type."""

  def test_crawl_documents_message_creation(self):
    """WorkerMessage.crawl_documents should create correct message."""
    from ingestors.webloader.loader.worker_types import WorkerMessage, MessageType, CrawlDocuments

    docs = CrawlDocuments(
      job_id="job-789",
      documents=[{"id": "d1", "page_content": "test", "metadata": {}}],
      batch_number=2,
      is_final_batch=False,
    )
    msg = WorkerMessage.crawl_documents(docs)

    assert msg.type == MessageType.CRAWL_DOCUMENTS
    assert msg.payload["job_id"] == "job-789"
    assert len(msg.payload["documents"]) == 1
    assert msg.payload["batch_number"] == 2
    assert msg.payload["is_final_batch"] is False

  def test_crawl_documents_message_serialization(self):
    """CRAWL_DOCUMENTS message should serialize/deserialize correctly."""
    from ingestors.webloader.loader.worker_types import WorkerMessage, MessageType, CrawlDocuments

    docs = CrawlDocuments(
      job_id="job-999",
      documents=[{"id": "d1", "page_content": "hello", "metadata": {"source": "test"}}],
      batch_number=3,
      is_final_batch=True,
    )
    msg = WorkerMessage.crawl_documents(docs)
    msg_dict = msg.to_dict()

    # Should serialize
    assert msg_dict["type"] == "crawl_documents"

    # Should deserialize
    restored = WorkerMessage.from_dict(msg_dict)
    assert restored.type == MessageType.CRAWL_DOCUMENTS
    assert restored.payload["job_id"] == "job-999"
    assert restored.payload["is_final_batch"] is True


class TestWorkerSpiderPlaywrightMeta:
  """Tests for Playwright meta configuration in WorkerSpider."""

  def _make_worker_spider(self, render_javascript: bool = False, wait_for_selector: str = None):
    """Create a WorkerSpider instance for testing."""
    from ingestors.webloader.loader.scrapy_worker import WorkerSpider
    from ingestors.webloader.loader.worker_types import CrawlRequest
    from multiprocessing import Queue

    request = CrawlRequest(
      job_id="test-job",
      url="https://example.com",
      datasource_id="test-ds",
      crawl_mode="single",
      max_pages=100,
      render_javascript=render_javascript,
      wait_for_selector=wait_for_selector,
      page_load_timeout=30,
    )
    result_queue = Queue()

    spider = WorkerSpider(request=request, result_queue=result_queue)
    return spider

  def test_build_request_meta_without_js_rendering(self):
    """_build_request_meta should return empty dict when JS rendering disabled."""
    spider = self._make_worker_spider(render_javascript=False)

    meta = spider._build_request_meta()

    assert "playwright" not in meta
    assert meta == {}

  def test_build_request_meta_with_js_rendering(self):
    """_build_request_meta should include Playwright settings when JS rendering enabled."""
    import pytest

    try:
      import scrapy_playwright  # noqa: F401
    except ImportError:
      pytest.skip("scrapy_playwright not installed")

    spider = self._make_worker_spider(render_javascript=True)

    meta = spider._build_request_meta()

    assert meta.get("playwright") is True
    assert "playwright_page_methods" in meta
    # Should have at least the networkidle wait
    assert len(meta["playwright_page_methods"]) >= 1

  def test_build_request_meta_with_wait_for_selector(self):
    """_build_request_meta should include wait_for_selector when configured."""
    import pytest

    try:
      import scrapy_playwright  # noqa: F401
    except ImportError:
      pytest.skip("scrapy_playwright not installed")

    spider = self._make_worker_spider(render_javascript=True, wait_for_selector="#main-content")

    meta = spider._build_request_meta()

    assert meta.get("playwright") is True
    # Should have 2 page methods: wait_for_selector + networkidle
    assert len(meta["playwright_page_methods"]) == 2

  def test_build_request_meta_preserves_extra_meta(self):
    """_build_request_meta should preserve extra meta fields."""
    spider = self._make_worker_spider(render_javascript=False)

    meta = spider._build_request_meta(base_url="https://example.com", custom_field="value")

    assert meta["base_url"] == "https://example.com"
    assert meta["custom_field"] == "value"

  def test_build_request_meta_combines_playwright_with_extra_meta(self):
    """_build_request_meta should combine Playwright settings with extra meta."""
    import pytest

    try:
      import scrapy_playwright  # noqa: F401
    except ImportError:
      pytest.skip("scrapy_playwright not installed")

    spider = self._make_worker_spider(render_javascript=True)

    meta = spider._build_request_meta(base_url="https://example.com")

    assert meta["base_url"] == "https://example.com"
    assert meta.get("playwright") is True
