---
sidebar_label: Data Model
sidebar_position: 4
---

# Data Model: Helm Chart Documentation Generator

## Entities

### ChartInfo

Extracted from each chart's `Chart.yaml`.

| Field | Source | Example | Notes |
|-------|--------|---------|-------|
| name | `Chart.yaml` → `.name` | `langgraph-redis` | Used for filenames and titles |
| description | `Chart.yaml` → `.description` | `Redis Stack for LangGraph...` | Falls back to "A Helm chart for Kubernetes" |
| version | `Chart.yaml` → `.version` | `0.2.38-rc.helm.2` | Local chart version (RC, not displayed) |
| appVersion | `Chart.yaml` → `.appVersion` | `0.2.38` | Fallback published version |
| publishedVersion | OCI registry or `CHART_VERSION` override | `0.2.38` | Resolved version displayed in docs |
| type | `Chart.yaml` → `.type` | `application` | Optional |
| sources | `Chart.yaml` → `.sources[]` | `https://github.com/...` | Optional, displayed as links |
| dependencies | `Chart.yaml` → `.dependencies[]` | See Dependency below | Only present on parent charts |

### Dependency

Each entry in a parent chart's `.dependencies[]` array.

| Field | Source | Example | Notes |
|-------|--------|---------|-------|
| name | `.dependencies[].name` | `supervisor-agent` | Subchart name |
| version | `.dependencies[].version` | `0.2.38-rc.helm.1` | Stripped to `0.2.38` on render |
| alias | `.dependencies[].alias` | `agent-argocd` | Optional, shown if different from name |
| condition | `.dependencies[].condition` | `global.langgraphRedis.enabled` | Enable/disable condition |
| tags | `.dependencies[].tags[]` | `["basic", "complete"]` | Tag groups |
| repository | `.dependencies[].repository` | `file://../rag-stack` | External or local reference |

### GeneratedFile

Output files produced by the generator.

| Field | Description | Example |
|-------|-------------|---------|
| sourcePath | Path to the source README in `charts/` | `charts/ai-platform-engineering/charts/langgraph-redis/README.md` |
| docusaurusPath | Path to the Docusaurus page in `docs/` | `docs/docs/installation/helm-charts/ai-platform-engineering/langgraph-redis.md` |
| chartDir | Chart directory containing `Chart.yaml` | `charts/ai-platform-engineering/charts/langgraph-redis` |
| parentGroup | Parent chart group name | `ai-platform-engineering` |
| isParent | Whether this is a parent chart | `true` / `false` |
| docId | Docusaurus frontmatter `id` | `langgraph-redis-chart` |
| sidebarLabel | Docusaurus frontmatter `sidebar_label` | `langgraph-redis` |

## Relationships

```text
ChartInfo 1──* Dependency       (parent charts only)
ChartInfo 1──1 GeneratedFile    (each chart produces one source README + one Docusaurus page)
```

## Chart Discovery Map

The generator discovers charts at these fixed locations:

| Parent Group | Parent Chart Path | Subchart Glob |
|--------------|-------------------|---------------|
| `ai-platform-engineering` | `charts/ai-platform-engineering/` | `charts/ai-platform-engineering/charts/*/` |
| `rag-stack` | `charts/rag-stack/` | `charts/rag-stack/charts/*/` |

Each directory matching the glob that contains a `Chart.yaml` is treated as a chart.
