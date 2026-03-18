---
id: agent-chart
sidebar_label: agent
---

:::caution Auto-generated
This page is auto-generated from the Helm chart source. Do not edit directly.
Regenerate with `make docs-helm-charts`.
:::

# agent

A Helm chart for Kubernetes

| | |
|---|---|
| **Version** | `0.2.38` |
| **Type** | application |

## Quick Start

```bash
# Add and install the chart
helm install agent oci://ghcr.io/cnoe-io/charts/agent --version 0.2.38

# Upgrade an existing release
helm upgrade agent oci://ghcr.io/cnoe-io/charts/agent --version 0.2.38
```

## Customizing Values

Override default values using `--set` flags or a custom values file:

```bash
# Override individual values
helm install agent oci://ghcr.io/cnoe-io/charts/agent --version 0.2.38 \
  --set replicaCount=2

# Use a custom values file
helm install agent oci://ghcr.io/cnoe-io/charts/agent --version 0.2.38 \
  -f custom-values.yaml

# Show all configurable values
helm show values oci://ghcr.io/cnoe-io/charts/agent --version 0.2.38
```

## Reading the Values Table

| Column | Meaning |
|--------|---------|
| **Key** | Dot-separated path into `values.yaml` (e.g. `image.repository`) |
| **Type** | Go/Helm data type (`string`, `int`, `bool`, `object`, `list`) |
| **Default** | Value used when not overridden |
| **Description** | What the parameter controls |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| agentExports.data.enabled | bool | `true` |  |
| agentSecrets.create | bool | `false` |  |
| agentSecrets.data | object | `{}` |  |
| agentSecrets.externalSecrets.data | list | `[]` |  |
| agentSecrets.externalSecrets.enabled | bool | `false` |  |
| agentSecrets.externalSecrets.name | string | `""` |  |
| agentSecrets.externalSecrets.secretStoreRef.kind | string | `"ClusterSecretStore"` |  |
| agentSecrets.externalSecrets.secretStoreRef.name | string | `""` |  |
| agentSecrets.externalSecrets.target | object | `{}` |  |
| agentSecrets.requiresSecret | bool | `true` |  |
| agentSecrets.secretName | string | `""` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| checkpointPersistence.mongodb.existingSecret.key | string | `""` |  |
| checkpointPersistence.mongodb.existingSecret.name | string | `""` |  |
| checkpointPersistence.mongodb.uri | string | `""` |  |
| checkpointPersistence.postgres.dsn | string | `""` |  |
| checkpointPersistence.postgres.existingSecret.key | string | `""` |  |
| checkpointPersistence.postgres.existingSecret.name | string | `""` |  |
| checkpointPersistence.redis.autoDiscoverService | string | `""` |  |
| checkpointPersistence.redis.dbIndex | int | `0` |  |
| checkpointPersistence.redis.existingSecret.key | string | `""` |  |
| checkpointPersistence.redis.existingSecret.name | string | `""` |  |
| checkpointPersistence.redis.url | string | `""` |  |
| checkpointPersistence.ttlMinutes | int | `0` |  |
| checkpointPersistence.type | string | `"memory"` |  |
| customPromptConfig | string | `""` |  |
| env | object | `{}` |  |
| fullnameOverride | string | `""` |  |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.repository | string | `""` |  |
| image.tag | string | `""` |  |
| imagePullSecrets | list | `[]` |  |
| ingress.annotations | object | `{}` |  |
| ingress.className | string | `""` |  |
| ingress.enabled | bool | `false` |  |
| ingress.hosts | list | `[]` |  |
| ingress.tls | list | `[]` |  |
| livenessProbe.failureThreshold | int | `3` |  |
| livenessProbe.initialDelaySeconds | int | `30` |  |
| livenessProbe.periodSeconds | int | `10` |  |
| livenessProbe.tcpSocket.port | string | `"http"` |  |
| livenessProbe.timeoutSeconds | int | `5` |  |
| llmSecrets.create | bool | `false` |  |
| llmSecrets.data | object | `{}` |  |
| llmSecrets.externalSecrets.data | list | `[]` |  |
| llmSecrets.externalSecrets.enabled | bool | `false` |  |
| llmSecrets.externalSecrets.secretStoreRef.kind | string | `"ClusterSecretStore"` |  |
| llmSecrets.externalSecrets.secretStoreRef.name | string | `""` |  |
| llmSecrets.secretName | string | `"llm-secret"` |  |
| mcp.image.repository | string | `nil` |  |
| mcp.image.tag | string | `""` |  |
| mcp.livenessProbe | object | `{}` |  |
| mcp.mode | string | `"http"` |  |
| mcp.readinessProbe | object | `{}` |  |
| mcp.resources | object | `{}` |  |
| mcp.service.port | int | `8000` |  |
| mcp.service.type | string | `"ClusterIP"` |  |
| mcp.volumeMounts | list | `[]` |  |
| mcp.volumes | list | `[]` |  |
| metrics.enabled | bool | `true` |  |
| nameOverride | string | `""` |  |
| nodeSelector | object | `{}` |  |
| podAnnotations | object | `{}` |  |
| podLabels | object | `{}` |  |
| podSecurityContext | object | `{}` |  |
| readinessProbe.failureThreshold | int | `3` |  |
| readinessProbe.initialDelaySeconds | int | `5` |  |
| readinessProbe.periodSeconds | int | `5` |  |
| readinessProbe.tcpSocket.port | string | `"http"` |  |
| readinessProbe.timeoutSeconds | int | `3` |  |
| remoteAgent | bool | `false` |  |
| replicaCount | int | `1` |  |
| resources | object | `{}` |  |
| revisionHistoryLimit | int | `3` |  |
| securityContext | object | `{}` |  |
| service.port | int | `8000` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` |  |
| serviceAccount.automount | bool | `true` |  |
| serviceAccount.create | bool | `true` |  |
| serviceAccount.name | string | `""` |  |
| slim.enabled | bool | `false` |  |
| slim.endpoint | string | `"http://ai-platform-engineering-slim:46357"` |  |
| slim.transport | string | `"slim"` |  |
| tolerations | list | `[]` |  |
| volumeMounts | list | `[]` |  |
| volumes | list | `[]` |  |

