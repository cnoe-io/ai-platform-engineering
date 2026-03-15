---
sidebar_label: supervisor-agent
---

# supervisor-agent

A Helm chart for the Supervisor Agent

## Parameters

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` | Pod affinity rules |
| autoscaling.enabled | bool | `false` | Enable Horizontal Pod Autoscaler |
| autoscaling.maxReplicas | int | `100` | HPA maximum replicas |
| autoscaling.minReplicas | int | `1` | HPA minimum replicas |
| autoscaling.targetCPUUtilizationPercentage | int | `80` | HPA target CPU utilization percentage |
| checkpointPersistence.mongodb.existingSecret.key | string | `""` | Key inside the secret |
| checkpointPersistence.mongodb.existingSecret.name | string | `""` | Name of a Kubernetes Secret containing the MongoDB URI |
| checkpointPersistence.mongodb.uri | string | `""` | MongoDB connection URI |
| checkpointPersistence.postgres.dsn | string | `""` | PostgreSQL DSN |
| checkpointPersistence.postgres.existingSecret.key | string | `""` | Key inside the secret |
| checkpointPersistence.postgres.existingSecret.name | string | `""` | Name of a Kubernetes Secret containing the Postgres DSN |
| checkpointPersistence.redis.autoDiscoverService | string | `""` | In-cluster Redis service name to auto-build the URL from |
| checkpointPersistence.redis.dbIndex | int | `0` | Redis DB index |
| checkpointPersistence.redis.existingSecret.key | string | `""` | Key inside the secret |
| checkpointPersistence.redis.existingSecret.name | string | `""` | Name of a Kubernetes Secret containing the Redis URL |
| checkpointPersistence.redis.url | string | `""` | Redis URL. Requires Redis Stack with RedisJSON + RediSearch modules |
| checkpointPersistence.ttlMinutes | int | `0` | TTL for checkpoints in minutes. `0` disables expiry |
| checkpointPersistence.type | string | `"memory"` | Checkpoint backend. One of: `memory` (in-process default), `redis`, `postgres`, `mongodb` |
| env | object | `{"EXTERNAL_URL":"http://localhost:8000"}` | Non-sensitive environment variables injected into the supervisor container |
| externalSecrets.enabled | bool | `false` | Enable External Secrets Operator integration |
| externalSecrets.secretNames | list | `[]` | List of existing ESO secret names to reference |
| fullnameOverride | string | `""` | Override the full release name |
| image.args | list | `["platform-engineer"]` | Container args |
| image.pullPolicy | string | `"Always"` | Image pull policy |
| image.repository | string | `"ghcr.io/cnoe-io/ai-platform-engineering"` | Container image repository |
| image.tag | string | `""` | Image tag. Defaults to chart appVersion when not set |
| imagePullSecrets | list | `[]` | Image pull secrets for private registries |
| ingress.annotations | object | `{}` | Ingress annotations |
| ingress.className | string | `""` | Ingress class name |
| ingress.enabled | bool | `false` | Enable ingress |
| ingress.hosts | list | `[]` | Ingress host rules |
| ingress.tls | list | `[]` | Ingress TLS configuration |
| livenessProbe | object | `{"failureThreshold":3,"initialDelaySeconds":30,"periodSeconds":10,"tcpSocket":{"port":"http"},"timeoutSeconds":5}` | Liveness probe configuration |
| llmSecrets.create | bool | `true` | Create the LLM secret. Set false if the secret already exists in the cluster |
| llmSecrets.data | object | `{}` | Key/value pairs for the LLM secret |
| llmSecrets.externalSecrets.data | list | `[]` | ESO data mappings |
| llmSecrets.externalSecrets.enabled | bool | `false` | Use External Secrets Operator for the LLM secret |
| llmSecrets.externalSecrets.secretStoreRef.kind | string | `"ClusterSecretStore"` | ESO SecretStore kind |
| llmSecrets.externalSecrets.secretStoreRef.name | string | `""` | ESO SecretStore name |
| llmSecrets.secretName | string | `"llm-secret"` | Name of the LLM secret |
| memoryPersistence.embeddings.dims | string | `""` | Embedding dimensions. Auto-detected for known models when empty |
| memoryPersistence.embeddings.model | string | `""` | Embedding model name (e.g. `text-embedding-3-small`) |
| memoryPersistence.embeddings.provider | string | `""` | Embedding provider for semantic memory search (`openai`, `azure-openai`, `litellm`) |
| memoryPersistence.enableFactExtraction | bool | `false` | Automatically extract facts from every conversation turn and store them for cross-thread recall |
| memoryPersistence.maxMemories | int | `50` | Maximum number of memory facts returned to the LLM per cross-thread context query |
| memoryPersistence.maxSummaries | int | `10` | Maximum number of conversation summaries returned to the LLM per cross-thread context query |
| memoryPersistence.mongodb.existingSecret.key | string | `""` | Key inside the secret (e.g. `MONGODB_URI`) |
| memoryPersistence.mongodb.existingSecret.name | string | `""` | Name of a Kubernetes Secret containing the MongoDB URI |
| memoryPersistence.mongodb.uri | string | `""` | MongoDB connection URI (e.g. `mongodb://host:27017`) |
| memoryPersistence.postgres.dsn | string | `""` | PostgreSQL DSN (e.g. `postgresql://user:pass@host:5432/db`). Prefer existingSecret for credentials |
| memoryPersistence.postgres.existingSecret.key | string | `""` | Key inside the secret (e.g. `DATABASE_URL`) |
| memoryPersistence.postgres.existingSecret.name | string | `""` | Name of a Kubernetes Secret containing the Postgres DSN |
| memoryPersistence.redis.autoDiscoverService | string | `""` | In-cluster Redis service name to auto-build the URL from (`redis://<release>-<service>:6379/<dbIndex>`). Common values: `langgraph-redis`, `rag-redis` |
| memoryPersistence.redis.dbIndex | int | `0` | Redis DB index. Use 1+ when sharing with RAG Redis (db 0 is RAG data) |
| memoryPersistence.redis.existingSecret.key | string | `""` | Key inside the secret (e.g. `REDIS_URL`) |
| memoryPersistence.redis.existingSecret.name | string | `""` | Name of a Kubernetes Secret containing the Redis URL |
| memoryPersistence.redis.keyPrefix | string | `""` | Key namespace prefix for shared Redis instances. Prevents key collisions across deployments |
| memoryPersistence.redis.url | string | `""` | Redis URL (e.g. `redis://host:6379/0`). Takes precedence over autoDiscoverService |
| memoryPersistence.ttlMinutes | int | `10080` | TTL for stored memory items in minutes. `0` disables expiry |
| memoryPersistence.type | string | `"memory"` | Memory store backend. One of: `memory` (in-process default), `redis`, `postgres`, `mongodb` |
| metrics.enabled | bool | `true` | Expose /metrics endpoint for Prometheus scraping |
| multiAgentConfig.agents | list | `[]` | Explicit agent list. Auto-discovered when empty |
| multiAgentConfig.port | string | `"8000"` | Port advertised to peer agents |
| multiAgentConfig.protocol | string | `"a2a"` | Agent-to-agent protocol (`a2a` or `slim`) |
| nameOverride | string | `""` | Override the chart name |
| nodeSelector | object | `{}` | Node selector labels |
| podAnnotations | object | `{}` | Extra annotations added to the pod |
| podLabels | object | `{}` | Extra labels added to the pod |
| podSecurityContext | object | `{}` | Pod-level security context |
| readinessProbe | object | `{"failureThreshold":3,"initialDelaySeconds":5,"periodSeconds":5,"tcpSocket":{"port":"http"},"timeoutSeconds":3}` | Readiness probe configuration |
| replicaCount | int | `1` | Number of replicas |
| resources | object | `{}` | CPU/memory requests and limits |
| revisionHistoryLimit | int | `3` | Number of old ReplicaSets to retain for rollback |
| securityContext | object | `{}` | Container-level security context |
| service.port | int | `8000` | Service port |
| service.type | string | `"ClusterIP"` | Kubernetes service type |
| serviceAccount.annotations | object | `{}` | Annotations to add to the service account |
| serviceAccount.automount | bool | `true` | Automount the service account API token |
| serviceAccount.create | bool | `true` | Create a service account |
| serviceAccount.name | string | `""` | Override the service account name. Generated from fullname template when empty |
| slim.enabled | bool | `false` | Enable SLIM transport (standalone fallback; in production provided by global.slim) |
| slim.endpoint | string | `"http://ai-platform-engineering-slim:46357"` | SLIM endpoint URL |
| slim.transport | string | `"slim"` | Transport label passed to agents |
| tolerations | list | `[]` | Pod tolerations |
| volumeMounts | list | `[]` | Extra volume mounts |
| volumes | list | `[]` | Extra volumes |
