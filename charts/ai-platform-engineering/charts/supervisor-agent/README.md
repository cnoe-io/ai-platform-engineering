# supervisor-agent

Helm chart for the AI Platform Engineering supervisor agent — the LangGraph-powered orchestrator that routes requests across specialized sub-agents.

## Parameters

### Image

| Parameter | Description | Default |
|---|---|---|
| `image.repository` | Container image repository | `ghcr.io/cnoe-io/ai-platform-engineering` |
| `image.tag` | Image tag (defaults to chart `appVersion`) | `""` |
| `image.pullPolicy` | Image pull policy | `Always` |
| `image.args` | Container args | `["platform-engineer"]` |
| `imagePullSecrets` | Image pull secrets | `[]` |

### Deployment

| Parameter | Description | Default |
|---|---|---|
| `replicaCount` | Number of replicas | `1` |
| `revisionHistoryLimit` | Old ReplicaSets to retain for rollback | `3` |
| `resources` | CPU/memory requests and limits | `{}` |
| `nodeSelector` | Node selector labels | `{}` |
| `tolerations` | Pod tolerations | `[]` |
| `affinity` | Pod affinity rules | `{}` |
| `podAnnotations` | Extra pod annotations | `{}` |
| `podLabels` | Extra pod labels | `{}` |
| `podSecurityContext` | Pod-level security context | `{}` |
| `securityContext` | Container-level security context | `{}` |
| `volumes` | Extra volumes | `[]` |
| `volumeMounts` | Extra volume mounts | `[]` |
| `autoscaling.enabled` | Enable HPA | `false` |
| `autoscaling.minReplicas` | HPA min replicas | `1` |
| `autoscaling.maxReplicas` | HPA max replicas | `100` |
| `autoscaling.targetCPUUtilizationPercentage` | HPA CPU target | `80` |

### Service

| Parameter | Description | Default |
|---|---|---|
| `service.type` | Kubernetes service type | `ClusterIP` |
| `service.port` | Service port | `8000` |

### Ingress

| Parameter | Description | Default |
|---|---|---|
| `ingress.enabled` | Enable ingress | `false` |
| `ingress.className` | Ingress class | `""` |
| `ingress.annotations` | Ingress annotations | `{}` |
| `ingress.hosts` | Ingress host rules | `[]` |
| `ingress.tls` | Ingress TLS config | `[]` |

### Probes

| Parameter | Description | Default |
|---|---|---|
| `livenessProbe` | Liveness probe spec | `tcpSocket :8000, delay 30s` |
| `readinessProbe` | Readiness probe spec | `tcpSocket :8000, delay 5s` |

### Service account

| Parameter | Description | Default |
|---|---|---|
| `serviceAccount.create` | Create service account | `true` |
| `serviceAccount.automount` | Automount API credentials | `true` |
| `serviceAccount.annotations` | Service account annotations | `{}` |
| `serviceAccount.name` | Override service account name | `""` |

### LLM secrets

| Parameter | Description | Default |
|---|---|---|
| `llmSecrets.create` | Create the LLM secret | `true` |
| `llmSecrets.secretName` | Secret name | `llm-secret` |
| `llmSecrets.data` | Key/value pairs for the secret | `{}` |
| `llmSecrets.externalSecrets.enabled` | Use External Secrets Operator | `false` |
| `llmSecrets.externalSecrets.secretStoreRef.name` | ESO secret store name | `""` |
| `llmSecrets.externalSecrets.secretStoreRef.kind` | ESO secret store kind | `ClusterSecretStore` |

### Multi-agent / protocol

| Parameter | Description | Default |
|---|---|---|
| `multiAgentConfig.protocol` | Agent-to-agent protocol (`a2a` or `slim`) | `a2a` |
| `multiAgentConfig.port` | Agent port advertised to peers | `8000` |
| `multiAgentConfig.agents` | Explicit agent list (overrides auto-discovery) | `[]` |
| `slim.enabled` | Enable SLIM transport (standalone fallback) | `false` |
| `slim.endpoint` | SLIM endpoint URL | `http://…-slim:46357` |
| `slim.transport` | Transport label passed to agents | `slim` |

### Metrics

| Parameter | Description | Default |
|---|---|---|
| `metrics.enabled` | Expose `/metrics` endpoint | `true` |

### Environment

| Parameter | Description | Default |
|---|---|---|
| `env.EXTERNAL_URL` | Agent URL advertised to clients | `http://localhost:8000` |

---

### Memory persistence (`memoryPersistence`)

Cross-thread memory store — user facts and conversation summaries that persist across separate threads.

| Parameter | Description | Default |
|---|---|---|
| `memoryPersistence.type` | Backend: `memory` \| `redis` \| `postgres` \| `mongodb` | `memory` |
| `memoryPersistence.ttlMinutes` | Item TTL in minutes (`0` = no expiry) | `10080` (7 days) |
| `memoryPersistence.enableFactExtraction` | Auto-extract facts from conversations | `false` |
| `memoryPersistence.maxMemories` | Max facts returned to LLM per cross-thread query | `50` |
| `memoryPersistence.maxSummaries` | Max summaries returned to LLM per cross-thread query | `10` |

**Redis** (`memoryPersistence.type: redis`)

| Parameter | Description | Default |
|---|---|---|
| `memoryPersistence.redis.url` | Direct Redis URL | `""` |
| `memoryPersistence.redis.existingSecret.name` | Secret containing the Redis URL | `""` |
| `memoryPersistence.redis.existingSecret.key` | Key inside the secret | `""` |
| `memoryPersistence.redis.autoDiscoverService` | In-cluster service name to auto-build URL from | `""` |
| `memoryPersistence.redis.dbIndex` | Redis DB index | `0` |
| `memoryPersistence.redis.keyPrefix` | Key namespace prefix for shared Redis | `""` |

**PostgreSQL** (`memoryPersistence.type: postgres`)

| Parameter | Description | Default |
|---|---|---|
| `memoryPersistence.postgres.dsn` | Postgres DSN | `""` |
| `memoryPersistence.postgres.existingSecret.name` | Secret containing the DSN | `""` |
| `memoryPersistence.postgres.existingSecret.key` | Key inside the secret | `""` |

**MongoDB** (`memoryPersistence.type: mongodb`)

| Parameter | Description | Default |
|---|---|---|
| `memoryPersistence.mongodb.uri` | MongoDB connection URI | `""` |
| `memoryPersistence.mongodb.existingSecret.name` | Secret containing the URI | `""` |
| `memoryPersistence.mongodb.existingSecret.key` | Key inside the secret | `""` |

**Embeddings** (optional — enables semantic/vector memory search)

| Parameter | Description | Default |
|---|---|---|
| `memoryPersistence.embeddings.provider` | Embedding provider (`openai`, `azure-openai`, `litellm`) | `""` |
| `memoryPersistence.embeddings.model` | Embedding model name | `""` |
| `memoryPersistence.embeddings.dims` | Embedding dimensions (auto-detected for known models) | `""` |

---

### Checkpoint persistence (`checkpointPersistence`)

In-thread checkpointer — persists the conversation graph state within a single thread across pod restarts.

| Parameter | Description | Default |
|---|---|---|
| `checkpointPersistence.type` | Backend: `memory` \| `redis` \| `postgres` \| `mongodb` | `memory` |
| `checkpointPersistence.ttlMinutes` | Checkpoint TTL in minutes (`0` = no expiry) | `0` |

**Redis** (`checkpointPersistence.type: redis`)

| Parameter | Description | Default |
|---|---|---|
| `checkpointPersistence.redis.url` | Direct Redis URL | `""` |
| `checkpointPersistence.redis.existingSecret.name` | Secret containing the Redis URL | `""` |
| `checkpointPersistence.redis.existingSecret.key` | Key inside the secret | `""` |
| `checkpointPersistence.redis.autoDiscoverService` | In-cluster service name to auto-build URL from | `""` |
| `checkpointPersistence.redis.dbIndex` | Redis DB index | `0` |

**PostgreSQL** (`checkpointPersistence.type: postgres`)

| Parameter | Description | Default |
|---|---|---|
| `checkpointPersistence.postgres.dsn` | Postgres DSN | `""` |
| `checkpointPersistence.postgres.existingSecret.name` | Secret containing the DSN | `""` |
| `checkpointPersistence.postgres.existingSecret.key` | Key inside the secret | `""` |

**MongoDB** (`checkpointPersistence.type: mongodb`)

| Parameter | Description | Default |
|---|---|---|
| `checkpointPersistence.mongodb.uri` | MongoDB connection URI | `""` |
| `checkpointPersistence.mongodb.existingSecret.name` | Secret containing the URI | `""` |
| `checkpointPersistence.mongodb.existingSecret.key` | Key inside the secret | `""` |
