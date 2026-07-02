---
id: ai-platform-engineering-chart
sidebar_label: ai-platform-engineering
---

# ai-platform-engineering

Parent chart for the CAIPE platform.

## Components

| Component | Purpose | Enablement |
|---|---|---|
| `caipe-ui` | Next.js UI and BFF | `tags.caipe-ui=true` |
| `dynamic-agents` | Chat runtime and agent execution service | `tags.dynamic-agents=true` |
| `mcp-*` | Per-integration MCP servers | `tags.mcp-<name>=true` |
| `rag-stack` | Optional RAG services | `tags.rag-stack=true` |
| `slack-bot` | Optional Slack surface | `tags.slack-bot=true` |
| `webex-bot` | Optional Webex surface | `tags.webex-bot=true` |
| `keycloak`, `openfga`, `agentgateway` | RBAC and MCP routing services | Values-driven |

## Quick Start

```bash
helm dependency update charts/ai-platform-engineering

helm template caipe charts/ai-platform-engineering \
  --set tags.caipe-ui=true \
  --set tags.dynamic-agents=true \
  --set tags.mcp-netutils=true \
  --set tags.rag-stack=false
```

## Common Values

```yaml
tags:
  caipe-ui: true
  dynamic-agents: true
  mcp-argocd: true
  mcp-github: true

caipe-ui:
  mongodb:
    enabled: true
  config:
    DYNAMIC_AGENTS_URL: ""

dynamic-agents:
  config:
    MONGODB_DATABASE: caipe

mcp-argocd:
  agentSecrets:
    secretName: existing-argocd-secret
```

Use `values.yaml` in the chart source for the complete value schema.
