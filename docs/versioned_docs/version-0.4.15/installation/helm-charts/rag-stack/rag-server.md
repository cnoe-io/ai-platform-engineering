---
id: rag-server-chart
sidebar_label: rag-server
---

:::caution Auto-generated
This page is auto-generated from the Helm chart source. Do not edit directly.
Regenerate with `make docs-helm-charts`.
:::

# rag-server

RAG server

| | |
|---|---|
| **Version** | `0.2.38` |
| **Type** | application |

## Quick Start

```bash
# Add and install the chart
helm install rag-server oci://ghcr.io/cnoe-io/charts/rag-server --version 0.2.38

# Upgrade an existing release
helm upgrade rag-server oci://ghcr.io/cnoe-io/charts/rag-server --version 0.2.38
```

## Customizing Values

Override default values using `--set` flags or a custom values file:

```bash
# Override individual values
helm install rag-server oci://ghcr.io/cnoe-io/charts/rag-server --version 0.2.38 \
  --set replicaCount=2

# Use a custom values file
helm install rag-server oci://ghcr.io/cnoe-io/charts/rag-server --version 0.2.38 \
  -f custom-values.yaml

# Show all configurable values
helm show values oci://ghcr.io/cnoe-io/charts/rag-server --version 0.2.38
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
| enableGraphRag | bool | `true` |  |
| env | object | `{}` |  |
| envFrom | list | `[]` |  |
| fullnameOverride | string | `"rag-server"` |  |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.repository | string | `"ghcr.io/cnoe-io/caipe-rag-server"` |  |
| image.tag | string | `""` |  |
| imagePullSecrets | list | `[]` |  |
| livenessProbe | object | `{}` |  |
| llmSecrets.secretName | string | `"llm-secret"` |  |
| nameOverride | string | `""` |  |
| nodeSelector | object | `{}` |  |
| podAnnotations | object | `{}` |  |
| podLabels | object | `{}` |  |
| readinessProbe | object | `{}` |  |
| replicaCount | int | `1` |  |
| resources | object | `{}` |  |
| revisionHistoryLimit | int | `3` |  |
| service.port | int | `9446` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` |  |
| serviceAccount.automount | bool | `false` |  |
| serviceAccount.create | bool | `false` |  |
| serviceAccount.name | string | `""` |  |
| tolerations | list | `[]` |  |
| webIngestor.enabled | bool | `true` |  |
| webIngestor.env | object | `{}` |  |
| webIngestor.envFrom | list | `[]` |  |
| webIngestor.image.pullPolicy | string | `"IfNotPresent"` |  |
| webIngestor.image.repository | string | `"ghcr.io/cnoe-io/caipe-rag-ingestors"` |  |
| webIngestor.image.tag | string | `""` |  |
| webIngestor.resources.limits.cpu | string | `"500m"` |  |
| webIngestor.resources.limits.ephemeral-storage | string | `"1Gi"` |  |
| webIngestor.resources.limits.memory | string | `"1Gi"` |  |
| webIngestor.resources.requests.cpu | string | `"100m"` |  |
| webIngestor.resources.requests.ephemeral-storage | string | `"256Mi"` |  |
| webIngestor.resources.requests.memory | string | `"256Mi"` |  |

