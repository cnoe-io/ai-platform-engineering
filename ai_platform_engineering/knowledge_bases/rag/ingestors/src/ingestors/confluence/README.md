# Confluence Ingestor

Syncs pages from Confluence spaces into the RAG (Retrieval-Augmented Generation) system for knowledge base integration.

## Architecture

This ingestor follows the webloader pattern with two operational modes:

1. **On-Demand Ingestion** - Redis listener processes individual page requests from the REST API (user-initiated)
2. **Periodic Reload** - Background task refreshes all configured spaces at regular intervals

Each Confluence space is treated as a datasource, with pages being ingested as documents within that datasource.

## Features

- On-demand page ingestion via REST API
- Automatic periodic syncing of configured spaces
- Space-level datasource organization (one datasource per space)
- HTML to plain text conversion with BeautifulSoup
- Chunking with LangChain RecursiveCharacterTextSplitter
- Retry logic with exponential backoff
- Concurrent page processing with configurable limits
- Job tracking with progress counters and error reporting

## Configuration

Required environment variables:

- `CONFLUENCE_URL` - Base URL of your Confluence instance (e.g., `https://yourcompany.atlassian.net/wiki`)
- `CONFLUENCE_USERNAME` - Confluence username/email
- `CONFLUENCE_TOKEN` - Confluence API token or password
- `REDIS_URL` - Redis connection URL (default: `redis://localhost:6379`)

Optional environment variables:

- `CONFLUENCE_SPACES` - JSON object mapping space keys to page configurations. Format: `{"SPACE_KEY": [{"page_id": "123", "get_child_pages": false}], "SPACE2": []}`. Empty array fetches entire space. If not set, only user-requested pages are ingested.
- `CONFLUENCE_SYNC_INTERVAL` - Sync interval in seconds (default: `86400` = 24 hours)
- `CONFLUENCE_SSL_VERIFY` - Enable SSL verification (default: `true`)
- `CONFLUENCE_MAX_CONCURRENCY` - Max concurrent page fetches (default: `5`)
- `CONFLUENCE_MAX_INGESTION_TASKS` - Max concurrent ingestion tasks from Redis queue (default: `5`)

## Usage

### Running the Ingestor

```bash
# Set required environment variables
export CONFLUENCE_URL="https://yourcompany.atlassian.net/wiki"
export CONFLUENCE_USERNAME="your.email@company.com"
export CONFLUENCE_TOKEN="your-api-token"

# Optional: configure auto-sync spaces
export CONFLUENCE_SPACES='{"DEV": [], "DOCS": [], "WIKI": []}'  # Sync entire spaces
# OR
export CONFLUENCE_SPACES='{"DEV": [{"page_id": "123"}], "DOCS": [{"page_id": "456", "get_child_pages": true}]}'  # Sync specific pages

# Run the ingestor
python ingestor.py
```

### Using the REST API

Users can trigger ingestion of individual Confluence pages via the REST API:

```bash
# Ingest a single page
curl -X POST "http://localhost:8080/v1/ingest/confluence/page" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourcompany.atlassian.net/wiki/spaces/DEV/pages/123456/Page-Title",
    "description": "Developer documentation"
  }'

# Ingest a page with child pages
curl -X POST "http://localhost:8080/v1/ingest/confluence/page" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourcompany.atlassian.net/wiki/spaces/DEV/pages/123456/Page-Title",
    "description": "Developer documentation",
    "get_child_pages": true
  }'

# Reload a datasource
curl -X POST "http://localhost:8080/v1/ingest/confluence/reload" \
  -H "Content-Type: application/json" \
  -d '{
    "datasource_id": "src_confluence___yourcompany_atlassian_net__DEV"
  }'

# Reload all datasources
curl -X POST "http://localhost:8080/v1/ingest/confluence/reload-all"
```

## How It Works

### On-Demand Ingestion Flow

1. User submits a Confluence page URL via REST API
2. Server creates/updates a space-level datasource and creates a job
3. Request is queued to Redis (`ingestor:confluence:requests`)
4. Ingestor picks up request from Redis queue
5. Page is fetched from Confluence REST API v1
6. HTML content is converted to plain text
7. Text is chunked using RecursiveCharacterTextSplitter
8. Documents are ingested into vector database with metadata
9. Job status is updated with progress and errors

### Periodic Reload Flow

1. Configured spaces (from `CONFLUENCE_SPACES`) are processed first
2. For each space, all pages are fetched using pagination
3. Existing datasources that haven't been updated recently are reloaded
4. Each reload creates a new job with progress tracking

### Datasource Model

**Space-Level Datasources**: Each Confluence space is one datasource

```python
DataSourceInfo(
    datasource_id="src_confluence___company_atlassian_net__SPACE",
    source_type="confluence",
    metadata={
        "confluence_ingest_request": {  # Original request for audit trail
            "url": "https://...",
            "description": "..."
        },
        "space_key": "SPACE",
        "page_configs": [  # List of page configurations
            {"page_id": "123", "get_child_pages": false, "source": "https://..."},
            {"page_id": "456", "get_child_pages": true}
        ],  # Empty list fetches entire space
        "confluence_url": "https://company.atlassian.net/wiki"
    }
)
```

**Document Metadata**: Each page chunk includes:
- `page_id` - Confluence page ID
- `space_key` - Space key
- `space_name` - Human-readable space name
- `url` - Direct link to page
- `created_date` - Page creation timestamp
- `last_modified` - Last modification Unix timestamp (for data retention pruning)
- `last_modified_iso` - Last modification timestamp (ISO string for display)
- `version` - Page version number
- `author` - Page creator
- `chunk_index` - Position in chunked document (0-indexed)
- `total_chunks` - Total chunks for this page
- `source` - Always "confluence"

## Confluence API

Uses Confluence REST API v1 (`/rest/api/content`):
- `/rest/api/content/{pageId}` - Fetch single page
- `/rest/api/content?spaceKey=X&type=page` - List pages in space
- Expands: `body.storage,version,space,history`
- Pagination: 100 pages per request

## Job Tracking

Jobs track ingestion progress with:
- `total` - Total pages to process
- `progress_counter` - Pages completed
- `failed_counter` - Pages that failed
- `error_msgs` - List of error messages
- `status` - PENDING, IN_PROGRESS, COMPLETED, COMPLETED_WITH_ERRORS, FAILED, or TERMINATED

Users can terminate jobs via the API, and the ingestor respects termination flags.

## Troubleshooting

### Authentication Issues
Ensure your API token has sufficient permissions to read spaces and pages. For Confluence Cloud, use an API token. For self-hosted, use username/password or token based on configuration.

### SSL Verification Errors
For self-hosted Confluence instances with self-signed certificates:
```bash
export CONFLUENCE_SSL_VERIFY="false"
```

### Rate Limiting
The ingestor includes automatic retry with exponential backoff (4 attempts, max 60s delay) for status codes 429, 502, 503, 504. Reduce `CONFLUENCE_MAX_CONCURRENCY` if you encounter persistent rate limiting.

### Memory Issues
Pages are chunked (default: 1000 chars, 200 overlap) and batched (100 documents per batch) to prevent memory issues. Adjust chunking in datasource metadata if needed.

### Page Not Found
If a page is deleted or moved, ingestion will fail for that page but continue with others. Check job error messages for details.

### Wrong Confluence Instance
The REST API validates submitted URLs against `CONFLUENCE_URL` (if configured on the server). Ensure URLs match the configured instance.

## Development

### Running Tests
```bash
# Unit tests (if available)
pytest tests/

# Manual testing with curl
export CONFLUENCE_URL="..."
export CONFLUENCE_USERNAME="..."
export CONFLUENCE_TOKEN="..."
python ingestor.py
```

### Code Structure
- `ingestor.py` - Main ingestor logic, Redis listener, periodic reload
- `loader.py` - ConfluenceLoader class for fetching and processing pages
- Helper functions for session creation, datasource ID generation, etc.
