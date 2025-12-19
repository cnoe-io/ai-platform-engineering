# Confluence RAG Ingestor

Syncs pages from Confluence spaces into the RAG (Retrieval-Augmented Generation) system for knowledge base integration.

## Features

- Fetches pages from configured Confluence spaces
- Supports incremental syncs using timestamps
- Converts HTML content to markdown
- Creates both documents and knowledge graph entities
- Includes retry logic with exponential backoff
- Batch processing to prevent memory issues

## Configuration

Required environment variables:

- `CONFLUENCE_URL` - Base URL of your Confluence instance (e.g., `https://yourcompany.atlassian.net/wiki`)
- `CONFLUENCE_USERNAME` - Confluence username/email
- `CONFLUENCE_TOKEN` - Confluence API token or password

Optional environment variables:

- `CONFLUENCE_SPACES` - Comma-separated list of space keys to sync (e.g., `DEV,DOCS,WIKI`). If not set, all accessible spaces will be discovered and synced.
- `CONFLUENCE_SYNC_INTERVAL` - Sync interval in seconds (default: `3600`)
- `CONFLUENCE_SSL_VERIFY` - Enable SSL verification (default: `true`)
- `CONFLUENCE_INGESTOR_NAME` - Name for this ingestor instance (default: `confluence-main`)
- `INIT_DELAY_SECONDS` - Initial delay before first sync in seconds (default: `0`)

## Usage

```bash
# Set required environment variables
export CONFLUENCE_URL="https://yourcompany.atlassian.net/wiki"
export CONFLUENCE_USERNAME="your.email@company.com"
export CONFLUENCE_TOKEN="your-api-token"

# Optional: specify spaces to sync
export CONFLUENCE_SPACES="DEV,DOCS,WIKI"

# Run the ingestor
python ingestor.py
```

## How It Works

1. **Initialization** - Connects to Confluence using provided credentials
2. **Space Discovery** - Either uses configured spaces or discovers all accessible spaces
3. **Incremental Sync** - Fetches only pages modified since last sync using CQL queries
4. **Content Processing** - Converts HTML to markdown and extracts metadata
5. **Entity Creation** - Creates knowledge graph entities for spaces, pages, and users
6. **Batch Ingestion** - Ingests documents and entities in batches to prevent memory issues

## Data Model

### Documents
Each Confluence page becomes a document with metadata including:
- Space key and name
- Page ID and URL
- Author and modification information
- Version number
- Page hierarchy (ancestors)

### Entities
Creates the following entity types in the knowledge graph:
- `ConfluenceSpace` - Confluence spaces
- `ConfluencePage` - Individual pages
- `ConfluenceUser` - Page authors and contributors

## Troubleshooting

### Authentication Issues
Ensure your API token has sufficient permissions to read spaces and pages.

### SSL Verification Errors
For self-hosted Confluence instances with self-signed certificates, set:
```bash
export CONFLUENCE_SSL_VERIFY="false"
```

### Rate Limiting
The ingestor includes automatic retry with exponential backoff for rate limit errors. Adjust `CONFLUENCE_SYNC_INTERVAL` if you encounter persistent rate limiting.

### Memory Issues
Large spaces are automatically batched (100 documents per batch). This is controlled by the `INGEST_BATCH_SIZE` constant in the code.
