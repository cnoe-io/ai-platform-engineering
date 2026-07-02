---
id: webex-bot-chart
sidebar_label: webex-bot
---

# webex-bot

Deploys the CAIPE Webex bot surface.

Webex routes CAIPE requests through the UI/BFF using `CAIPE_API_URL`; the BFF
applies authz and streams through Dynamic Agents.

## Common Values

| Key | Purpose |
|---|---|
| `config.CAIPE_API_URL` | UI/BFF URL |
| `config.WEBEX_AGENT_ROUTES_MODE` | Route source mode |
| `config.WEBEX_DEFAULT_AGENT_ID` | Default dynamic-agent ID for auto-assignment |
| `config.WEBEX_THREAD_CONTEXT_ENABLED` | Include bounded Webex thread context |
| `existingSecret` | Webex tokens and sensitive env vars |
| `keycloakBot.clientSecretFromSecret` | Keycloak OBO client secret reference |
| `serviceAccount` | Pod service account |

Use `charts/ai-platform-engineering/charts/webex-bot/values.yaml` for the
complete value schema.
