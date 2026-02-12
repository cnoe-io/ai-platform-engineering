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
