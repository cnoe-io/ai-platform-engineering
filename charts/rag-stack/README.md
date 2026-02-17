# RAG Stack Helm Chart

A complete RAG (Retrieval-Augmented Generation) stack with hybrid search, graph RAG, web UI, and multi-source ingestion.

## Quick Start

```bash
# Install with defaults
helm install rag-stack ./charts/rag-stack

# Install with custom values
helm install rag-stack ./charts/rag-stack -f custom-values.yaml
```

## Components

### Core Services
- **rag-server** - REST API, ingestion, search, MCP tools (Port: 9446)
- **agent-ontology** - Automatic schema discovery with LLM evaluation (Port: 8098)
- **rag-webui** - React web interface (Port: 80)
- **web-ingestor** - URL/sitemap ingestion (sidecar in rag-server pod)

### Databases
- **neo4j** - Graph database for entities and relationships
- **rag-redis** - Cache and job queue
- **milvus** - Vector database with etcd and minio

### Optional Ingestors
- **rag-ingestors** - Deploy multiple ingestors (AWS, K8s, ArgoCD, Slack, Webex, Backstage)

## Configuration

RAG server and web ingestor configuration is done via environment variables using the `env:` map in values.yaml.

### RAG Server Configuration

```yaml
rag-server:
  # Feature flag with global fallback
  enableGraphRag: true

  # All other config via env map
  env:
    ENABLE_MCP: "true"
    EMBEDDINGS_PROVIDER: "azure-openai"
    EMBEDDINGS_MODEL: "text-embedding-3-small"
    LOG_LEVEL: "INFO"
    # ... see values.yaml for all options
```

### RAG Server Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_MCP` | `true` | Enable/disable MCP tools for AI agents |
| `SKIP_INIT_TESTS` | `false` | Skip connection tests on startup |
| `EMBEDDINGS_PROVIDER` | `azure-openai` | Provider: `azure-openai`, `openai`, `litellm` |
| `EMBEDDINGS_MODEL` | `text-embedding-3-small` | Embeddings model name |
| `LITELLM_API_BASE` | - | LiteLLM proxy URL (required when using `litellm` provider) |
| `LOG_LEVEL` | `INFO` | Logging level: DEBUG, INFO, WARNING, ERROR |
| `MAX_DOCUMENTS_PER_INGEST` | `1000` | Max documents per ingestion request |
| `MAX_RESULTS_PER_QUERY` | `100` | Max results per query |
| `ALLOW_UNAUTHENTICATED` | `true` | Allow access without authentication |
| `RBAC_ADMIN_GROUPS` | `` | Comma-separated group names with admin access |
| `RBAC_READONLY_GROUPS` | `` | Comma-separated group names with read-only access |
| `RBAC_DEFAULT_ROLE` | `readonly` | Default role when user doesn't match any group |

### Web Ingestor Configuration

```yaml
rag-server:
  webIngestor:
    enabled: true
    env:
      LOG_LEVEL: "INFO"
      WEBLOADER_MAX_CONCURRENCY: "10"
      # Scrapy settings (optional)
      SCRAPY_CONCURRENT_REQUESTS: "16"
      SCRAPY_JAVASCRIPT_ENABLED: "true"
```

## High Availability & Production Readiness

### PodDisruptionBudgets (PDBs)

PodDisruptionBudgets protect stateful components during voluntary disruptions (node drains, cluster autoscaling, rolling updates). The chart supports optional PDBs for:

| Component | Default Replicas | Recommended PDB Setting |
|-----------|------------------|------------------------|
| MinIO | 4 | maxUnavailable: 1 |
| etcd | 3 | maxUnavailable: 1 |
| queryNode | 1 | maxUnavailable: 1 |
| dataNode | 1 | maxUnavailable: 1 |

**Enable PDBs for production deployments:**

```yaml
milvus:
  minio:
    podDisruptionBudget:
      enabled: true
      maxUnavailable: 1  # Only allow 1 pod down during voluntary disruptions

  etcd:
    podDisruptionBudget:
      enabled: true
      maxUnavailable: 1  # Maintains quorum (2/3 pods available)

  queryNode:
    podDisruptionBudget:
      enabled: true
      maxUnavailable: 1  # Protect search capacity

  dataNode:
    podDisruptionBudget:
      enabled: true
      maxUnavailable: 1  # Protect data persistence
```

**Alternative: Use `minAvailable` instead:**

```yaml
milvus:
  minio:
    podDisruptionBudget:
      enabled: true
      minAvailable: 3  # Ensure 3/4 pods available (maintains quorum)

  etcd:
    podDisruptionBudget:
      enabled: true
      minAvailable: 2  # Ensure 2/3 pods available (maintains quorum)
```

**Note:** PDBs only protect against voluntary disruptions. They do not prevent involuntary disruptions like node failures, OOM kills, or application crashes.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Logging level |
| `WEBLOADER_MAX_CONCURRENCY` | `10` | Max concurrent HTTP requests per ingestion |
| `WEBLOADER_MAX_INGESTION_TASKS` | `5` | Max concurrent ingestion tasks |
| `WEBLOADER_RELOAD_INTERVAL` | `86400` | Auto-reload interval in seconds (24 hours) |
| `SCRAPY_CONCURRENT_REQUESTS` | `16` | Scrapy concurrent requests |
| `SCRAPY_DOWNLOAD_DELAY` | `0` | Delay between requests in seconds |
| `SCRAPY_DEPTH_LIMIT` | `0` | Max crawl depth (0 = unlimited) |
| `SCRAPY_JAVASCRIPT_ENABLED` | `false` | Enable JavaScript rendering via Playwright |

### LiteLLM Embeddings Example

To use LiteLLM proxy for embeddings:

```yaml
rag-server:
  env:
    EMBEDDINGS_PROVIDER: "litellm"
    EMBEDDINGS_MODEL: "azure/text-embedding-3-small"
    LITELLM_API_BASE: "http://litellm-proxy:4000"
    # LITELLM_API_KEY: "sk-..." # or use envFrom with a secret
```

### Using Secrets

For sensitive values, use `envFrom` to reference a Kubernetes Secret:

```yaml
rag-server:
  envFrom:
    - secretRef:
        name: rag-server-secrets
```

## Secrets Required

### LLM Secrets (for agent-ontology)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: llm-secret
stringData:
  OPENAI_API_KEY: "sk-..."
```

Or configure via global values:

```yaml
global:
  llmSecrets:
    data:
      OPENAI_API_KEY: "sk-..."
```

### Ingestor Secrets

See `values.yaml` under `rag-ingestors.ingestors[]` for examples of:
- AWS credentials
- ArgoCD auth tokens
- Slack bot tokens
- Webex access tokens
- Backstage API tokens
- Kubeconfig for external K8s clusters

## Ingestor Configuration

Deploy multiple ingestors by configuring the `rag-ingestors` chart:

```yaml
rag-ingestors:
  enabled: true
  ingestors:
    - name: aws-prod
      type: aws
      syncInterval: 86400       # 24 hours
      env:
        AWS_REGION: us-east-1
      envFrom:
        - secretRef:
            name: aws-credentials
```

See `values.yaml` for complete examples of:
- AWS ingestor
- K8s in-cluster ingestor
- K8s external ingestor with kubeconfig
- ArgoCD ingestor
- Slack ingestor with channels
- Webex ingestor with spaces
- Backstage ingestor

## Authentication (Optional)

OAuth2 Proxy integration for OIDC/OAuth2 authentication with group-based RBAC.

**Important:** When enabling OAuth2 Proxy, disable the rag-webui direct ingress. Traffic must flow through OAuth2 Proxy.

```yaml
oauth2-proxy:
  enabled: true
  config:
    clientID: "YOUR_CLIENT_ID"
    clientSecret: "YOUR_CLIENT_SECRET"
    cookieSecret: "BASE64_SECRET"  # openssl rand -base64 32 | head -c 32 | base64
  extraArgs:
    provider: "oidc"
    oidc-issuer-url: "https://your-idp.com/oidc"
    oidc-groups-claim: "groups"
  ingress:
    enabled: true
    hosts:
      - host: rag-webui.example.com

rag-server:
  env:
    ALLOW_UNAUTHENTICATED: "false"
    RBAC_READONLY_GROUPS: "viewers,engineers"
    RBAC_ADMIN_GROUPS: "admins"
    RBAC_DEFAULT_ROLE: "readonly"

rag-webui:
  ingress:
    enabled: false  # Must be disabled when using oauth2-proxy
```

RBAC roles: `readonly` (search only), `ingestonly` (ingest only), `admin` (full access).

## Access Points

| Service | URL | Description |
|---------|-----|-------------|
| Web UI | `http://rag-webui.local` | Main interface (configure ingress) |
| REST API | `http://rag-server:9446/docs` | Swagger docs |
| MCP Tools | `http://rag-server:9446/mcp` | MCP endpoint |
| Neo4j | `http://rag-neo4j:7474` | Graph browser |

## Common Operations

### Update dependencies
```bash
helm dependency update ./charts/rag-stack
```

### Upgrade release
```bash
helm upgrade rag-stack ./charts/rag-stack -f custom-values.yaml
```

### View logs
```bash
kubectl logs -f deployment/rag-server
kubectl logs -f deployment/agent-ontology
kubectl logs -f deployment/rag-ingestors-<name>
```

### Check health
```bash
kubectl exec deployment/rag-server -- curl http://localhost:9446/healthz
```

## Migration Guide

If upgrading from a previous version that used individual values.yaml keys, migrate to the new `env:` map format:

### RAG Server Settings

| Old values.yaml Key | New env: Key |
|---------------------|--------------|
| `enableMcp` | `ENABLE_MCP` |
| `skipInitTests` | `SKIP_INIT_TESTS` |
| `embeddingsProvider` | `EMBEDDINGS_PROVIDER` |
| `embeddingsModel` | `EMBEDDINGS_MODEL` |
| `maxDocumentsPerIngest` | `MAX_DOCUMENTS_PER_INGEST` |
| `maxResultsPerQuery` | `MAX_RESULTS_PER_QUERY` |
| `maxIngestionConcurrency` | `MAX_INGESTION_CONCURRENCY` |
| `maxGraphRawQueryResults` | `MAX_GRAPH_RAW_QUERY_RESULTS` |
| `maxGraphRawQueryTokens` | `MAX_GRAPH_RAW_QUERY_TOKENS` |
| `searchResultTruncateLength` | `SEARCH_RESULT_TRUNCATE_LENGTH` |
| `logLevel` | `LOG_LEVEL` |
| `uiUrl` | `UI_URL` |
| `sleepOnInitFailureSeconds` | `SLEEP_ON_INIT_FAILURE_SECONDS` |
| `cleanupInterval` | `CLEANUP_INTERVAL` |
| `rbac.allowUnauthenticated` | `ALLOW_UNAUTHENTICATED` |
| `rbac.readonlyGroups` | `RBAC_READONLY_GROUPS` |
| `rbac.ingestonlyGroups` | `RBAC_INGESTONLY_GROUPS` |
| `rbac.adminGroups` | `RBAC_ADMIN_GROUPS` |
| `rbac.defaultRole` | `RBAC_DEFAULT_ROLE` |

### Web Ingestor Settings

| Old values.yaml Key | New env: Key |
|---------------------|--------------|
| `webIngestor.logLevel` | `LOG_LEVEL` |
| `webIngestor.maxConcurrency` | `WEBLOADER_MAX_CONCURRENCY` |
| `webIngestor.maxIngestionTasks` | `WEBLOADER_MAX_INGESTION_TASKS` |
| `webIngestor.reloadInterval` | `WEBLOADER_RELOAD_INTERVAL` |

### Example Migration

**Before (old format):**
```yaml
rag-server:
  enableMcp: true
  embeddingsProvider: azure-openai
  logLevel: INFO
  rbac:
    allowUnauthenticated: true
    adminGroups: "admins"
```

**After (new format):**
```yaml
rag-server:
  env:
    ENABLE_MCP: "true"
    EMBEDDINGS_PROVIDER: "azure-openai"
    LOG_LEVEL: "INFO"
    ALLOW_UNAUTHENTICATED: "true"
    RBAC_ADMIN_GROUPS: "admins"
```

**Note:** `enableGraphRag` remains unchanged as it has global fallback support via `global.enableGraphRag`.

## Notes

- Change Neo4j password from `dummy_password` in production
- All configuration options are documented in `values.yaml`
- Store sensitive credentials in Kubernetes Secrets
- Default sync intervals: 24 hours for ingestors, 72 hours for ontology agent
- Default resource limits are suitable for development; increase for production
