# RAG Server

The server component provides REST APIs for document ingestion, vector search, graph exploration, and MCP tools for AI agents.

## Quick Start

### Running with Docker Compose

The server requires several dependencies. Use the root `docker-compose.yaml` to start all services:

```bash
docker compose --profile deps up
```

### Running Locally

1. Install dependencies:
```bash
cd server
uv sync
```

2. Set environment variables (see Configuration below)

3. Start the server:
```bash
source ./.venv/bin/activate
LOG_LEVEL=DEBUG python src/server/__main__.py
```

The server will be available at `http://localhost:9446`

## Service Connections

### Required Services

| Service | Default Connection | Purpose |
|---------|-------------------|---------|
| Redis | `redis://localhost:6379` | Metadata storage and job queue |
| Milvus | `http://localhost:19530` | Vector database for hybrid search |
| Neo4j | `bolt://localhost:7687` | Graph database (optional, if Graph RAG enabled) |

### Optional Services

| Service | Default Connection | Purpose |
|---------|-------------------|---------|
| Ontology Agent | `http://localhost:8098` | Graph ontology management (if Graph RAG enabled) |

## Ports

| Port | Service | Description |
|------|---------|-------------|
| 9446 | REST API | Main API endpoints for ingestion, query, and management |
| 9446 | MCP Server | Model Context Protocol endpoints at `/mcp/*` |

## Configuration

### Core Connection Settings

```bash
# Redis
REDIS_URL=redis://localhost:6379

# Milvus Vector Database
MILVUS_URI=http://localhost:19530

# Neo4j Graph Database (if Graph RAG enabled)
NEO4J_ADDR=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
```

### Feature Flags

```bash
# Enable/disable graph RAG features
ENABLE_GRAPH_RAG=true

# Enable/disable MCP tools for AI agents
ENABLE_MCP=true

# Skip connection tests on startup (useful for debugging)
SKIP_INIT_TESTS=false
```

### Embeddings Configuration

```bash
# Embeddings provider (azure_openai or openai)
EMBEDDINGS_PROVIDER=azure_openai

# Model name
EMBEDDINGS_MODEL=text-embedding-3-small

# Azure OpenAI (if using azure_openai provider)
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_VERSION=2024-02-15-preview

# OpenAI (if using openai provider)
OPENAI_API_KEY=your-api-key
```

### Performance & Limits

```bash
# Max documents per ingestion request
MAX_DOCUMENTS_PER_INGEST=1000

# Max results per query
MAX_RESULTS_PER_QUERY=100

# Max concurrent tasks during ingestion
MAX_INGESTION_CONCURRENCY=30

# Max results for raw graph queries
MAX_GRAPH_RAW_QUERY_RESULTS=100

# Max tokens in raw query results before truncation
MAX_GRAPH_RAW_QUERY_TOKENS=80000

# Truncate search results to N characters (for MCP tools)
SEARCH_RESULT_TRUNCATE_LENGTH=500
```

### Other Settings

```bash
# Logging level (DEBUG, INFO, WARNING, ERROR)
LOG_LEVEL=INFO

# WebUI URL (for health check response)
UI_URL=http://localhost:9447

# Ontology agent service URL (if Graph RAG enabled)
ONTOLOGY_AGENT_RESTAPI_ADDR=http://localhost:8098

# Sleep duration (seconds) on init failure before shutdown
SLEEP_ON_INIT_FAILURE_SECONDS=180

# Cleanup interval (seconds) for stale data
CLEANUP_INTERVAL=10800
```

## Milvus Collection Configuration

The server creates a collection named `rag_default` with:

**Dense Vector Index (Semantic Search):**
- Type: HNSW (Hierarchical Navigable Small World)
- Metric: Cosine similarity
- Dimension: Based on embeddings model

**Sparse Vector Index (Keyword Search):**
- Type: Sparse Inverted Index
- Metric: BM25
- Auto-generated from text content

**Dynamic Fields:** Enabled for flexible metadata storage

## Neo4j Configuration

When Graph RAG is enabled, the server uses **tenant labels** to isolate data in shared Neo4j instances:

- **Data Graph**: `NxsDataEntity` - Stores entity instances
- **Ontology Graph**: `NxsSchemaEntity` - Stores entity schemas


## Health Check

Check server health and configuration:

```bash
curl http://localhost:9446/healthz
```

Response includes:
- Service initialization status
- Database connections
- Enabled features
- Available datasources
- Configuration details

## API Documentation

Once the server is running, view interactive API docs:

- **Swagger UI**: http://localhost:9446/docs
- **ReDoc**: http://localhost:9446/redoc

## MCP Tools

The server exposes MCP (Model Context Protocol) tools for AI agents at `/mcp/*` endpoints.

For detailed architecture and tool descriptions, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Deployment

### Docker

Build the server image:

```bash
docker build -f build/Dockerfile.server -t rag-server .
```

Run with environment variables:

```bash
docker run -d \
  -p 9446:9446 \
  -e REDIS_URL=redis://redis:6379 \
  -e MILVUS_URI=http://milvus:19530 \
  -e NEO4J_ADDR=bolt://neo4j:7687 \
  -e AZURE_OPENAI_API_KEY=${AZURE_OPENAI_API_KEY} \
  -e AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT} \
  rag-server
```

## Troubleshooting

### Slow ingestion

- Increase `MAX_INGESTION_CONCURRENCY` (default: 30)
- Check Milvus resource allocation
- Monitor Neo4j memory usage (if Graph RAG enabled)

### Query timeouts

- Increase Milvus query timeout
- Reduce `MAX_RESULTS_PER_QUERY` for faster responses
- Use more specific filters to narrow search scope

### Out of memory

- Reduce `MAX_DOCUMENTS_PER_INGEST` for smaller batches
- Decrease `MAX_INGESTION_CONCURRENCY`
- Allocate more memory to Milvus and Neo4j containers

## Development

### Running tests

```bash
cd server
uv run pytest
```

### Adding new endpoints

1. Add endpoint to `restapi.py`
2. Update models in `common/src/common/models/`
3. Add tests in `tests/`
4. Update API documentation

### Adding new MCP tools

1. Add tool method to `AgentTools` class in `tools.py`
2. Register tool in `register_tools()` method
3. Add documentation in `ARCHITECTURE.md`

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Detailed architecture documentation
- [Common Models](../common/README.md) - Shared data models
- [Ingestors](../ingestors/README.md) - Building custom ingestors

