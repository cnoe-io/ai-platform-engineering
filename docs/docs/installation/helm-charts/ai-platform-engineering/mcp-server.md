---
id: mcp-server-chart
sidebar_label: mcp-server
---

# mcp-server

Deploys one MCP server Deployment and Service.

The umbrella chart uses this chart through aliases such as `mcp-argocd`,
`mcp-github`, and `mcp-netutils`.

## Common Values

| Key | Purpose |
|---|---|
| `mcp.image.repository` | MCP container image repository |
| `mcp.image.tag` | MCP container image tag |
| `mcp.mode` | MCP transport mode |
| `mcp.service.port` | Kubernetes Service port |
| `agentSecrets` | Integration credentials |
| `llmSecrets` | LLM provider credentials |
| `resources` | Pod resource requests and limits |
| `volumes`, `volumeMounts` | Extra mounts |

Use `charts/ai-platform-engineering/charts/mcp-server/values.yaml` for the
complete value schema.
