---
sidebar_position: 4
---

# Helm

Deploy AI Platform Engineering on any Kubernetes cluster using the official Helm chart published to GitHub Container Registry.

## Prerequisites

- [Helm 3](https://helm.sh/docs/intro/install/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/) configured against your cluster
- A running cluster ([Minikube](https://minikube.sigs.k8s.io/docs/start/), Kind, EKS, GKE, AKS, etc.)

## Chart registry

The chart is published as an OCI artifact:

```
oci://ghcr.io/cnoe-io/charts/ai-platform-engineering
```

Browse available versions (stable releases only, no RCs):
👉 **[ghcr.io/cnoe-io/charts/ai-platform-engineering](https://github.com/cnoe-io/ai-platform-engineering/pkgs/container/charts%2Fai-platform-engineering)**

## Chart structure

```
ai-platform-engineering/        # Parent chart
├── README.md                   # Full parameter reference
└── charts/
    ├── supervisor-agent/       # Orchestrator / LangGraph supervisor
    │   └── README.md
    ├── agent/                  # Generic agent subchart (aliased per integration)
    ├── langgraph-redis/        # Redis Stack for persistence (optional)
    │   └── README.md
    ├── caipe-ui/               # CAIPE web UI (optional)
    ├── rag-stack/              # RAG pipeline (optional)
    └── slim/ slim-control-plane/  # AGNTCY SLIM dataplane (optional)
```

Full parameter tables for each chart:

- [`charts/ai-platform-engineering/README.md`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/charts/ai-platform-engineering/README.md)
- [`charts/ai-platform-engineering/charts/supervisor-agent/README.md`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/charts/ai-platform-engineering/charts/supervisor-agent/README.md)
- [`charts/ai-platform-engineering/charts/langgraph-redis/README.md`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/charts/ai-platform-engineering/charts/langgraph-redis/README.md)

## Step 1 — Get example values files

Pull the chart locally to access the bundled example values files:

```bash
helm pull oci://ghcr.io/cnoe-io/charts/ai-platform-engineering --version <VERSION> --untar
```

Replace `<VERSION>` with the latest stable version from the [registry page](https://github.com/cnoe-io/ai-platform-engineering/pkgs/container/charts%2Fai-platform-engineering).

## Step 2 — Configure secrets

Choose one of three approaches to provide API keys and agent credentials.

### Option A — Direct values file (development)

```bash
cp ai-platform-engineering/values-secrets.yaml.example values-secrets.yaml
# Edit values-secrets.yaml with your LLM keys and agent credentials
```

> Never commit `values-secrets.yaml`.

### Option B — Existing Kubernetes Secrets

If your secrets are already in the cluster:

```yaml
# values.yaml
agent-argocd:
  secrets:
    secretName: "my-existing-secret"
```

### Option C — External Secrets Operator (recommended for production)

```bash
cp ai-platform-engineering/values-external-secrets.yaml.example values-external-secrets.yaml
# Edit to point at your Vault / AWS Secrets Manager / GCP Secret Manager store
```

## Step 3 — Choose agents

Agents are enabled via Helm tags. Common profiles:

| Tag | Agents included |
|---|---|
| `basic` | argocd, backstage, github |
| `complete` | all agents |
| Individual | `agent-argocd`, `agent-github`, `agent-jira`, `agent-slack`, … |

## Step 4 — Install

```bash
# Minimal (in-memory, no persistence)
helm install ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version <VERSION> \
  --values values-secrets.yaml

# With basic agents
helm install ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version <VERSION> \
  --values values-secrets.yaml \
  --set tags.basic=true

# With External Secrets Operator
helm install ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version <VERSION> \
  --values values-external-secrets.yaml
```

## Step 5 — Verify

```bash
kubectl get pods
kubectl get services
```

Wait for pods to reach `Running` / `1/1 Ready`.

## Step 6 — Access

### Port-forward (quickest)

```bash
kubectl port-forward service/ai-platform-engineering-supervisor-agent 8000:8000
```

Then connect with the agent chat CLI:

```bash
uvx --no-cache git+https://github.com/cnoe-io/agent-chat-cli.git a2a --host localhost --port 8000
```

### Ingress (domain access)

```bash
# Enable ingress on Minikube
minikube addons enable ingress

# Deploy with ingress
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version <VERSION> \
  --values values-secrets.yaml \
  --values ai-platform-engineering/values-ingress.yaml.example

# Add Minikube IP to /etc/hosts
echo "$(minikube ip) supervisor-agent.local" | sudo tee -a /etc/hosts
```

## Upgrade and uninstall

```bash
# Upgrade to a new version
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version <NEW_VERSION> \
  --values values-secrets.yaml

# Uninstall
helm uninstall ai-platform-engineering
```

## Prompt configuration

| Value | Description |
|---|---|
| `promptConfigType: default` | Balanced orchestrator, general use (default) |
| `promptConfigType: deep_agent` | Strict zero-hallucination mode for production |
| `promptConfig: \|` | Provide a fully custom prompt config inline |

```bash
helm install ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version <VERSION> \
  --values values-secrets.yaml \
  --set promptConfigType=deep_agent
```

## Persistence

See the [Persistence](./persistence.md) page for full options (in-memory default, Redis, Postgres, MongoDB, fact extraction).

### Quick start — Redis persistence

```yaml
# values-persistence.yaml
global:
  langgraphRedis:
    enabled: true

supervisor-agent:
  checkpointPersistence:
    type: redis
    redis:
      autoDiscoverService: langgraph-redis

  memoryPersistence:
    type: redis
    redis:
      autoDiscoverService: langgraph-redis
    enableFactExtraction: true
    maxMemories: 50
    maxSummaries: 10
```

```bash
helm install ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version <VERSION> \
  --values values-secrets.yaml \
  --values values-persistence.yaml
```

Or as `--set` flags:

```bash
helm install ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version <VERSION> \
  --values values-secrets.yaml \
  --set global.langgraphRedis.enabled=true \
  --set supervisor-agent.checkpointPersistence.type=redis \
  --set supervisor-agent.checkpointPersistence.redis.autoDiscoverService=langgraph-redis \
  --set supervisor-agent.memoryPersistence.type=redis \
  --set supervisor-agent.memoryPersistence.redis.autoDiscoverService=langgraph-redis \
  --set supervisor-agent.memoryPersistence.enableFactExtraction=true
```

## Optional components

| Component | Helm flag | Notes |
|---|---|---|
| RAG stack | `--set tags.rag-stack=true` | Milvus, Langfuse, embedding server |
| CAIPE UI | `--set tags.caipe-ui=true` | Web chat UI |
| SLIM dataplane | `--set global.slim.enabled=true` | AGNTCY SLIM transport |
| Redis persistence | `--set global.langgraphRedis.enabled=true` | See [Persistence](./persistence.md) |
| Slack bot | `--set tags.slack-bot=true` | Slack client (not an agent) |

## Security notes

- Use Kubernetes Secrets or the External Secrets Operator for credentials — never inline plaintext in committed files.
- Rotate LLM API keys regularly.
- Use HTTPS in production (configure TLS in `ingress.tls`).
