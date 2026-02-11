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

All components are fully configurable via `values.yaml`. See the file for:

- **RAG Server**: Feature flags, embeddings config, performance limits, web ingestor settings
- **Agent Ontology**: Sync intervals, evaluation thresholds, LLM worker configuration
- **Ingestors**: Per-ingestor deployment with type-specific environment variables
- **Databases**: Resource limits, persistence, connection settings

Refer to `values.yaml` for detailed configuration options and commented examples for each component.

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

Each component's environment variables are documented in `values.yaml` with:
- Variable names (e.g., `ENABLE_GRAPH_RAG`)
- Values.yaml keys (e.g., `enableGraphRag`)
- Default values
- Descriptions

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
  rbac:
    allowUnauthenticated: false
    readonlyGroups: "viewers,engineers"
    adminGroups: "admins"
    defaultRole: "readonly"

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

## Notes

- ⚠️ Change Neo4j password from `dummy_password` in production
- 📝 All configuration options are documented in `values.yaml`
- 🔐 Store sensitive credentials in Kubernetes Secrets
- 📊 Default sync intervals: 24 hours for ingestors, 72 hours for ontology agent
- 💾 Default resource limits are suitable for development; increase for production

