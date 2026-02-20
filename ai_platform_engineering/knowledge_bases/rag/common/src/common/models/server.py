from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from langchain_core.documents import Document


# ============================================================================
# Web Scraping Configuration Models
# ============================================================================


class CrawlMode(str, Enum):
  """How to discover pages to crawl."""

  SINGLE_URL = "single"  # Only the specified URL
  SITEMAP = "sitemap"  # Discover and crawl sitemap
  RECURSIVE = "recursive"  # Follow links from starting URL


class ScrapySettings(BaseModel):
  """Scraping configuration exposed to users."""

  # Crawl behavior
  crawl_mode: CrawlMode = Field(CrawlMode.SINGLE_URL, description="How to discover pages: 'single' (just this URL), 'sitemap' (discover sitemap), 'recursive' (follow links)")
  max_depth: int = Field(2, description="Maximum link depth for recursive crawling", ge=1, le=10)
  max_pages: int = Field(2000, description="Maximum pages to crawl", ge=1)

  # JavaScript rendering
  render_javascript: bool = Field(False, description="Enable JavaScript rendering via Playwright (slower but handles SPAs)")
  wait_for_selector: Optional[str] = Field(None, description="CSS selector to wait for before extracting content (JS rendering only)")
  page_load_timeout: int = Field(15, description="Page load timeout in seconds", ge=5, le=120)

  # URL filtering
  follow_external_links: bool = Field(False, description="Follow links to external domains (recursive mode only)")
  allowed_url_patterns: Optional[List[str]] = Field(None, description="Regex patterns for URLs to include (whitelist)")
  denied_url_patterns: Optional[List[str]] = Field(None, description="Regex patterns for URLs to exclude (blacklist)")

  # Rate limiting
  download_delay: float = Field(0.05, description="Delay between requests to same domain (seconds)", ge=0)
  concurrent_requests: int = Field(30, description="Maximum concurrent requests", ge=1, le=50)
  respect_robots_txt: bool = Field(True, description="Obey robots.txt rules")

  # Chunking
  chunk_size: int = Field(10000, description="Maximum size of each text chunk in characters", ge=100, le=100000)
  chunk_overlap: int = Field(2000, description="Overlap between chunks in characters", ge=0, le=10000)

  # Misc
  user_agent: Optional[str] = Field(None, description="Custom user agent string (defaults to Chrome-like UA)")


# ============================================================================
# Models for Ingestor ping and registration
# ============================================================================
class IngestorPingRequest(BaseModel):
  ingestor_type: str = Field(..., description="Type of the ingestor")
  ingestor_name: str = Field(..., description="Name of the ingestor")
  description: Optional[str] = Field("", description="Description of the ingestor")
  metadata: Optional[Dict[str, Any]] = Field({}, description="Additional metadata for the ingestor")


class IngestorPingResponse(BaseModel):
  ingestor_id: str = Field(..., description="Unique identifier for the ingestor")
  max_documents_per_ingest: int = Field(..., description="Maximum number of documents the server can handle per request")
  message: str = Field(..., description="Response message from the server")


# ============================================================================
# General Ingestor Models
# ============================================================================


class IngestorRequest(BaseModel):
  ingestor_id: str = Field(..., description="ID of the ingestor performing the ingestion")
  command: str = Field(..., description="Command to execute")
  payload: Optional[Any] = Field(..., description="Data associated with the command")


class DocumentIngestRequest(BaseModel):
  documents: List[Document] = Field(..., description="List of langchain Documents to ingest")
  ingestor_id: str = Field(..., description="ID of the ingestor ingesting these documents")
  datasource_id: str = Field(..., description="ID of the datasource associated with these documents")
  job_id: Optional[str] = Field(None, description="Job ID associated with this ingestion")
  fresh_until: Optional[int] = Field(0, description="Timestamp until which this data is considered fresh (epoch seconds)")


# ============================================================================
# Models specific for Web Ingestor
# ============================================================================


class UrlIngestRequest(BaseModel):
  """Request to ingest a URL with configurable scraping settings."""

  url: str = Field(..., description="URL to ingest")
  description: str = Field("", description="Description for this data source")
  settings: ScrapySettings = Field(default_factory=lambda: ScrapySettings(), description="Scraping configuration (crawl mode, JS rendering, rate limiting, etc.)")
  reload_interval: Optional[int] = Field(None, description="Auto-reload interval in seconds. If not specified, uses global DEFAULT_DATASOURCE_RELOAD_INTERVAL (default 24h). Minimum: 300 seconds (5 minutes).")

  # DEPRECATED fields - will be removed in a future version.
  # Use 'settings' object instead.
  check_for_sitemaps: Optional[bool] = Field(None, description="DEPRECATED: Use settings.crawl_mode instead")
  sitemap_max_urls: Optional[int] = Field(None, description="DEPRECATED: Use settings.max_pages instead")
  ingest_type: Optional[str] = Field(None, description="DEPRECATED: No longer used")


class UrlReloadRequest(BaseModel):
  datasource_id: str = Field(..., description="ID of the URL datasource to reload")


class WebIngestorCommand(str, Enum):
  INGEST_URL = "ingest-url"
  RELOAD_ALL = "reload-all"
  RELOAD_DATASOURCE = "reload-datasource"


# ============================================================================
# Models specific for Confluence Ingestor
# ============================================================================


class ConfluenceIngestRequest(BaseModel):
  url: str = Field(..., description="Confluence page URL (e.g., 'https://domain.atlassian.net/wiki/spaces/SPACE/pages/PAGE_ID/Title')")
  description: str = Field("", description="Description for this data source")
  get_child_pages: bool = Field(False, description="Whether to ingest direct child pages of this page")


class ConfluenceReloadRequest(BaseModel):
  datasource_id: str = Field(..., description="ID of the Confluence datasource to reload")


class ConfluenceIngestorCommand(str, Enum):
  INGEST_PAGE = "ingest-page"
  RELOAD_ALL = "reload-all"
  RELOAD_DATASOURCE = "reload-datasource"


# ============================================================================
# Models for Graph Exploration and Querying
# ============================================================================
class ExploreNeighborhoodRequest(BaseModel):
  entity_type: str = Field(..., description="Type of the entity to explore")
  entity_pk: str = Field(..., description="Primary key of the entity to explore")
  depth: int = Field(1, description="Depth of neighborhood to explore (0 = just entity, 1 = direct neighbors, etc.)", ge=0, le=10)


class ExploreDataEntityRequest(BaseModel):
  entity_type: str = Field(..., description="Type of the entity to fetch")
  entity_pk: str = Field(..., description="Primary key of the entity to fetch")


class ExploreEntityRequest(BaseModel):
  entity_type: Optional[str] = Field(None, description="Type of entity to explore")
  filter_by_properties: Optional[Dict[str, str]] = Field(None, description="Properties to filter by")


class ExploreRelationsRequest(BaseModel):
  from_type: Optional[str] = Field(None, description="Type of the source entity")
  to_type: Optional[str] = Field(None, description="Type of the target entity")
  relation_name: Optional[str] = Field(None, description="Name of the relation")
  filter_by_properties: Optional[Dict[str, str]] = Field(None, description="Properties to filter relations by")


# ============================================================================
# Models for Querying
# ============================================================================
class QueryRequest(BaseModel):
  query: str = Field(..., description="Query string to search for")
  limit: int = Field(3, description="Maximum number of results to return", ge=1, le=100)
  similarity_threshold: float = Field(0.3, description="Minimum similarity score", ge=0.0, le=1.0)
  filters: Optional[Dict[str, str | bool]] = Field(None, description="Additional filters as key-value pairs")
  ranker_type: str = Field("weighted", description="Type of ranker to use")
  ranker_params: Optional[Dict[str, Any]] = Field({"weights": [0.7, 0.3]}, description="Parameters for the ranker")


class QueryResult(BaseModel):
  document: Document
  score: float
