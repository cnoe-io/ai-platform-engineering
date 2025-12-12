# Backstage Ingestor

Ingests entities from a Backstage catalog into the RAG system as graph entities. Fetches all catalog entities with pagination support and converts them to searchable entities with proper metadata.

## Required Environment Variables

- `BACKSTAGE_URL` - Base URL of your Backstage API (e.g., `https://backstage.example.com`)
- `BACKSTAGE_API_TOKEN` - Authentication token for Backstage API access
- `RAG_SERVER_URL` - URL of the RAG server (default: `http://localhost:9446`)

## Optional Environment Variables

- `IGNORE_TYPES` - Comma-separated list of entity kinds to skip (default: `template,api,resource`)
- `SYNC_INTERVAL` - Sync interval in seconds (default: `86400` = 24 hours)
- `INIT_DELAY_SECONDS` - Delay before first sync in seconds (default: `0`)
- `LOG_LEVEL` - Logging level (default: `INFO`)

## Running with Docker Compose

Make sure the RAG server is up and running before starting the ingestor.

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446 # Adjust based on your setup
export BACKSTAGE_URL=<your-backstage-url>
export BACKSTAGE_API_TOKEN=<your-backstage-token> 
docker compose --profile backstage up --build backstage_ingestor
```

