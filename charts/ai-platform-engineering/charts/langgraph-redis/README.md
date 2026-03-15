# langgraph-redis

Redis Stack subchart for LangGraph checkpoint and memory store persistence. Deploys Redis 8.0 Alpine, which includes RedisJSON and RediSearch natively — both required by `langgraph-checkpoint-redis`.

Enabled via `global.langgraphRedis.enabled: true` in the parent chart.

## Parameters

### Image

| Parameter | Description | Default |
|---|---|---|
| `image.repository` | Container image repository | `redis` |
| `image.tag` | Image tag | `8.0-alpine` |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `imagePullSecrets` | Image pull secrets | `[]` |

### Deployment

| Parameter | Description | Default |
|---|---|---|
| `replicaCount` | Number of replicas | `1` |
| `revisionHistoryLimit` | Old ReplicaSets to retain for rollback | `3` |
| `resources.requests.cpu` | CPU request | `100m` |
| `resources.requests.memory` | Memory request | `256Mi` |
| `resources.limits.cpu` | CPU limit | `500m` |
| `resources.limits.memory` | Memory limit | `512Mi` |
| `nodeSelector` | Node selector labels | `{}` |
| `tolerations` | Pod tolerations | `[]` |
| `affinity` | Pod affinity rules | `{}` |
| `podAnnotations` | Extra pod annotations | `{}` |
| `podLabels` | Extra pod labels | `{}` |
| `podSecurityContext.fsGroup` | Pod fsGroup | `1000` |
| `securityContext.runAsUser` | Container user | `999` |
| `securityContext.runAsNonRoot` | Run as non-root | `true` |
| `securityContext.allowPrivilegeEscalation` | Allow privilege escalation | `false` |
| `securityContext.readOnlyRootFilesystem` | Read-only root filesystem | `false` |
| `volumes` | Extra volumes | `[]` |
| `volumeMounts` | Extra volume mounts | `[]` |

### Service

| Parameter | Description | Default |
|---|---|---|
| `service.type` | Kubernetes service type | `ClusterIP` |
| `service.port` | Redis port | `6379` |

### Persistence (PVC)

| Parameter | Description | Default |
|---|---|---|
| `persistence.enabled` | Enable PersistentVolumeClaim | `true` |
| `persistence.storageClass` | Storage class name (`""` = cluster default) | `""` |
| `persistence.accessModes` | PVC access modes | `[ReadWriteOnce]` |
| `persistence.size` | PVC size | `2Gi` |

### Probes

| Parameter | Description | Default |
|---|---|---|
| `livenessProbe` | Liveness probe spec | `redis-cli ping, delay 15s, period 10s` |
| `readinessProbe` | Readiness probe spec | `redis-cli ping, delay 5s, period 5s` |

### Service account

| Parameter | Description | Default |
|---|---|---|
| `serviceAccount.create` | Create service account | `true` |
| `serviceAccount.automount` | Automount API credentials | `true` |
| `serviceAccount.annotations` | Service account annotations | `{}` |
| `serviceAccount.name` | Override service account name | `""` |
