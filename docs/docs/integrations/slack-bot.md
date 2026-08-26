# Slack Bot Integration

The CAIPE Slack bot brings dynamic-agent chat into Slack channels and DMs.

## Architecture

```mermaid
flowchart LR
  U[Slack user] --> S[Slack API]
  S --> B[Slack bot]
  B --> UI[CAIPE UI/BFF]
  UI --> DA[Dynamic Agents]
  DA --> MCP[MCP tools]
  B --> M[(MongoDB)]
```

The bot calls the UI/BFF through `CAIPE_API_URL`. The BFF enforces access,
creates or resumes conversations, and streams responses through Dynamic Agents
using the AG-UI protocol. The deprecated supervisor/A2A path is not used.

## AG-UI Migration Verification

The transition is independently verifiable from this repository:

- `sse_client.py` identifies the client as Dynamic Agents AG-UI streaming and
  sends `protocol: "agui"` with stream and invoke requests.
- `utils/ai.py` owns the AG-UI streaming and non-streaming invoke paths.
- `test_sse_client.py`, `test_hitl_handler.py`, and
  `test_metadata_leak_e2e.py` exercise the protocol client, human-in-the-loop
  events, and streaming path.

From the repository root, run:

```bash
uv run pytest ai_platform_engineering/integrations/slack_bot/tests/test_sse_client.py \
  ai_platform_engineering/integrations/slack_bot/tests/test_hitl_handler.py \
  ai_platform_engineering/integrations/slack_bot/tests/test_metadata_leak_e2e.py
rg -n -i 'supervisor|a2a' ai_platform_engineering/integrations/slack_bot --glob '*.py'
```

The second command should produce no matches; the test command verifies the
remaining AG-UI behavior.

## Core Features

- Channel and DM routing to configured dynamic-agent IDs
- Thread-aware follow-ups with bounded Slack thread context
- MongoDB-backed route, team, and link metadata
- Human-in-the-loop forms rendered as Slack blocks
- Feedback actions and audit events
- Optional service-account authentication for BFF calls
- Just-in-time Keycloak user creation for Slack users when enabled

## Required Slack Scopes

| Scope | Purpose |
|---|---|
| `app_mentions:read` | Detect mentions |
| `channels:history`, `groups:history`, `im:history`, `mpim:history` | Read messages where the bot participates |
| `channels:read`, `groups:read`, `im:read` | Resolve channel and DM metadata |
| `chat:write` | Post replies |
| `reactions:write` | Add feedback/status reactions |

## Optional Slack Scopes

| Scope | Purpose |
|---|---|
| `files:read` | Read files attached to messages. Without it, the bot continues with the message text and tells the user that it could not access the attachment. |

## Important Environment Variables

| Variable | Purpose |
|---|---|
| `CAIPE_API_URL` | UI/BFF base URL |
| `SLACK_BOT_MODE` | `socket` or `http` |
| `SLACK_AGENT_ROUTES_MODE` | `db_prefer`, `config`, or `db_only` |
| `SLACK_DEFAULT_TEAM_SLUG` | Team used for auto-assignment |
| `SLACK_DEFAULT_AGENT_ID` | Dynamic-agent ID used for auto-assignment |
| `MONGODB_URI` | Route/link/team metadata storage |
| `MONGODB_DATABASE` | MongoDB database name |
| `SLACK_JIT_CREATE_USER` | Enable Keycloak user creation for Slack-only users |

Sensitive Slack and OAuth values belong in Kubernetes Secrets or ExternalSecrets.

## Helm

```yaml
tags:
  slack-bot: true

slack-bot:
  config:
    CAIPE_API_URL: http://ai-platform-engineering-caipe-ui:3000
    SLACK_AGENT_ROUTES_MODE: db_prefer
    SLACK_DEFAULT_AGENT_ID: platform-engineer
  existingSecret: slack-bot-secrets
```

See the [slack-bot chart reference](../installation/helm-charts/ai-platform-engineering/slack-bot.md)
for chart values.
