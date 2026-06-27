---
id: caipe-ui-chart
sidebar_label: caipe-ui
---

# caipe-ui

Deploys the CAIPE Next.js UI and BFF.

The UI talks to Dynamic Agents server-side through `DYNAMIC_AGENTS_URL` and
proxies browser chat streams through `/api/v1/chat/stream/*`.

## Common Values

| Key | Purpose |
|---|---|
| `config.DYNAMIC_AGENTS_URL` | Dynamic Agents service URL |
| `config.MONGODB_DATABASE` | MongoDB database name |
| `mongodb.enabled` | Deploy bundled MongoDB subchart |
| `existingSecret` | Secret with sensitive runtime env vars |
| `externalSecrets` | ExternalSecret integration |
| `appConfig.models` | UI model selector entries |
| `appConfig.mcp_servers` | Dynamic-agent MCP bootstrap entries |

Use `charts/ai-platform-engineering/charts/caipe-ui/values.yaml` for the
complete value schema.
