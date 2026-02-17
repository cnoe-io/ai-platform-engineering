## Helm Chart Simplification

Replaced individual `values.yaml` keys with a generic `env:` map pattern. This reduces template complexity and makes adding new environment variables easier without chart changes.

### What Changed

**Kept as computed values** (from global config):
- `REDIS_URL`, `NEO4J_*`, `MILVUS_URI`, `ONTOLOGY_AGENT_RESTAPI_ADDR`
- `enableGraphRag` (has global fallback)

**Everything else** now uses `env:` map with string values.

### Migration Table

#### RAG Server

| Removed Key | Use Instead |
|-------------|-------------|
| `enableMcp` | `env.ENABLE_MCP` |
| `skipInitTests` | `env.SKIP_INIT_TESTS` |
| `embeddingsProvider` | `env.EMBEDDINGS_PROVIDER` |
| `embeddingsModel` | `env.EMBEDDINGS_MODEL` |
| `maxDocumentsPerIngest` | `env.MAX_DOCUMENTS_PER_INGEST` |
| `maxResultsPerQuery` | `env.MAX_RESULTS_PER_QUERY` |
| `maxIngestionConcurrency` | `env.MAX_INGESTION_CONCURRENCY` |
| `logLevel` | `env.LOG_LEVEL` |
| `rbac.allowUnauthenticated` | `env.ALLOW_UNAUTHENTICATED` |
| `rbac.adminGroups` | `env.RBAC_ADMIN_GROUPS` |
| `rbac.readonlyGroups` | `env.RBAC_READONLY_GROUPS` |
| `rbac.defaultRole` | `env.RBAC_DEFAULT_ROLE` |

#### Web Ingestor

| Removed Key | Use Instead |
|-------------|-------------|
| `webIngestor.logLevel` | `webIngestor.env.LOG_LEVEL` |
| `webIngestor.maxConcurrency` | `webIngestor.env.WEBLOADER_MAX_CONCURRENCY` |
| `webIngestor.maxIngestionTasks` | `webIngestor.env.WEBLOADER_MAX_INGESTION_TASKS` |
| `webIngestor.reloadInterval` | `webIngestor.env.WEBLOADER_RELOAD_INTERVAL` |

### Example

**Before:**
```yaml
rag-server:
  enableMcp: true
  logLevel: INFO
  rbac:
    adminGroups: "admins"
```

**After:**
```yaml
rag-server:
  env:
    ENABLE_MCP: "true"
    LOG_LEVEL: "INFO"
    RBAC_ADMIN_GROUPS: "admins"
```
