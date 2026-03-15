# langgraph-redis

Redis Stack for LangGraph checkpoint and store persistence

Enabled via `global.langgraphRedis.enabled: true` in the parent chart.

## Parameters

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` | Pod affinity rules |
| fullnameOverride | string | `""` | Override the full release name |
| image.pullPolicy | string | `"IfNotPresent"` | Image pull policy |
| image.repository | string | `"redis"` | Container image repository |
| image.tag | string | `"8.0-alpine"` | Image tag |
| imagePullSecrets | list | `[]` | Image pull secrets for private registries |
| livenessProbe | object | `{"exec":{"command":["redis-cli","ping"]},"initialDelaySeconds":15,"periodSeconds":10}` | Liveness probe configuration |
| nameOverride | string | `""` | Override the chart name |
| nodeSelector | object | `{}` | Node selector labels |
| persistence.accessModes | list | `["ReadWriteOnce"]` | PVC access modes |
| persistence.enabled | bool | `true` | Enable PersistentVolumeClaim for Redis data |
| persistence.size | string | `"2Gi"` | PVC size |
| persistence.storageClass | string | `""` | Storage class name. Empty string uses the cluster default |
| podAnnotations | object | `{}` | Extra annotations added to the pod |
| podLabels | object | `{}` | Extra labels added to the pod |
| podSecurityContext.fsGroup | int | `1000` | fsGroup for the pod |
| readinessProbe | object | `{"exec":{"command":["redis-cli","ping"]},"initialDelaySeconds":5,"periodSeconds":5}` | Readiness probe configuration |
| replicaCount | int | `1` | Number of replicas |
| resources.limits.cpu | string | `"500m"` | CPU limit |
| resources.limits.memory | string | `"512Mi"` | Memory limit |
| resources.requests.cpu | string | `"100m"` | CPU request |
| resources.requests.memory | string | `"256Mi"` | Memory request |
| revisionHistoryLimit | int | `3` | Number of old ReplicaSets to retain for rollback |
| securityContext.allowPrivilegeEscalation | bool | `false` | Prevent privilege escalation |
| securityContext.capabilities.drop[0] | string | `"ALL"` |  |
| securityContext.readOnlyRootFilesystem | bool | `false` | Read-only root filesystem |
| securityContext.runAsNonRoot | bool | `true` | Run as non-root user |
| securityContext.runAsUser | int | `999` | UID to run as |
| service.port | int | `6379` | Redis port |
| service.type | string | `"ClusterIP"` | Kubernetes service type |
| serviceAccount.annotations | object | `{}` | Annotations to add to the service account |
| serviceAccount.automount | bool | `true` | Automount the service account API token |
| serviceAccount.create | bool | `true` | Create a service account |
| serviceAccount.name | string | `""` | Override the service account name |
| tolerations | list | `[]` | Pod tolerations |
| volumeMounts | list | `[]` | Extra volume mounts |
| volumes | list | `[]` | Extra volumes |
