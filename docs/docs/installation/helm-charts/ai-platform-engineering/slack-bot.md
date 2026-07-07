---
id: slack-bot-chart
sidebar_label: slack-bot
---

# slack-bot

Deploys the CAIPE Slack bot surface.

Slack routes CAIPE requests through the UI/BFF using `CAIPE_API_URL`; the BFF
applies authz and streams through Dynamic Agents.

## Common Values

| Key | Purpose |
|---|---|
| `config.CAIPE_API_URL` | UI/BFF URL |
| `config.SLACK_BOT_MODE` | `socket` or `http` |
| `config.SLACK_AGENT_ROUTES_MODE` | Route source mode |
| `config.SLACK_DEFAULT_AGENT_ID` | Default dynamic-agent ID for auto-assignment |
| `existingSecret` | Slack tokens and sensitive env vars |
| `keycloakBot.clientSecretFromSecret` | Keycloak OBO client secret reference |
| `serviceAccount` | Pod service account |

Use `charts/ai-platform-engineering/charts/slack-bot/values.yaml` for the
complete value schema.
