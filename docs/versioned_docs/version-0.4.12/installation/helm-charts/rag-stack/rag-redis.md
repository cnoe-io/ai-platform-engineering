---
id: rag-redis-chart
sidebar_label: rag-redis
---

:::caution Auto-generated
This page is auto-generated from the Helm chart source. Do not edit directly.
Regenerate with `make docs-helm-charts`.
:::

# rag-redis

A Helm chart for Kubernetes

| | |
|---|---|
| **Version** | `0.2.38` |
| **Type** | application |

## Quick Start

```bash
# Add and install the chart
helm install rag-redis oci://ghcr.io/cnoe-io/charts/rag-redis --version 0.2.38

# Upgrade an existing release
helm upgrade rag-redis oci://ghcr.io/cnoe-io/charts/rag-redis --version 0.2.38
```

## Customizing Values

Override default values using `--set` flags or a custom values file:

```bash
# Override individual values
helm install rag-redis oci://ghcr.io/cnoe-io/charts/rag-redis --version 0.2.38 \
  --set replicaCount=2

# Use a custom values file
helm install rag-redis oci://ghcr.io/cnoe-io/charts/rag-redis --version 0.2.38 \
  -f custom-values.yaml

# Show all configurable values
helm show values oci://ghcr.io/cnoe-io/charts/rag-redis --version 0.2.38
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
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| exports.host | string | `"rag-redis"` |  |
| exports.port | int | `6379` |  |
| fullnameOverride | string | `""` |  |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.repository | string | `"redis"` |  |
| image.tag | string | `"7.2-alpine"` |  |
| imagePullSecrets | list | `[]` |  |
| ingress.annotations | object | `{}` |  |
| ingress.className | string | `""` |  |
| ingress.enabled | bool | `false` |  |
| ingress.hosts[0].host | string | `"chart-example.local"` |  |
| ingress.hosts[0].paths[0].path | string | `"/"` |  |
| ingress.hosts[0].paths[0].pathType | string | `"ImplementationSpecific"` |  |
| ingress.tls | list | `[]` |  |
| livenessProbe.exec.command[0] | string | `"redis-cli"` |  |
| livenessProbe.exec.command[1] | string | `"ping"` |  |
| livenessProbe.failureThreshold | int | `3` |  |
| livenessProbe.initialDelaySeconds | int | `30` |  |
| livenessProbe.periodSeconds | int | `10` |  |
| livenessProbe.timeoutSeconds | int | `5` |  |
| nameOverride | string | `""` |  |
| nodeSelector | object | `{}` |  |
| persistence.accessModes[0] | string | `"ReadWriteOnce"` |  |
| persistence.enabled | bool | `false` |  |
| persistence.size | string | `"8Gi"` |  |
| persistence.storageClass | string | `""` |  |
| podAnnotations | object | `{}` |  |
| podLabels | object | `{}` |  |
| podSecurityContext | object | `{}` |  |
| readinessProbe.exec.command[0] | string | `"redis-cli"` |  |
| readinessProbe.exec.command[1] | string | `"ping"` |  |
| readinessProbe.failureThreshold | int | `3` |  |
| readinessProbe.initialDelaySeconds | int | `5` |  |
| readinessProbe.periodSeconds | int | `5` |  |
| readinessProbe.timeoutSeconds | int | `3` |  |
| replicaCount | int | `1` |  |
| resources | object | `{}` |  |
| revisionHistoryLimit | int | `3` |  |
| securityContext | object | `{}` |  |
| service.port | int | `6379` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` |  |
| serviceAccount.automount | bool | `true` |  |
| serviceAccount.create | bool | `true` |  |
| serviceAccount.name | string | `""` |  |
| tolerations | list | `[]` |  |
| volumeMounts | list | `[]` |  |
| volumes | list | `[]` |  |

