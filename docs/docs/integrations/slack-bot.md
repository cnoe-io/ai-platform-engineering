# Slack Bot Integration

The CAIPE Slack Bot brings AI-powered platform engineering assistance directly into Slack. It connects to the CAIPE supervisor via the [A2A protocol](https://a2a-protocol.org/), allowing users to interact with the full multi-agent system from any Slack channel or DM.

:::note
The Slack Bot is a **client integration**, not an agent. It does not expose an A2A server or MCP tools — it acts as an interface between Slack and the CAIPE supervisor, similar to how the CAIPE Web UI works.
:::

## Architecture

```mermaid
flowchart LR
  subgraph Slack
    U[User] -->|"@mention / message"| S[Slack API]
  end
  subgraph CAIPE Slack Bot
    S -->|Socket / HTTP| B[Slack Bot]
    B -->|A2A streaming| SUP[CAIPE Supervisor]
    B -->|Session storage| M[(MongoDB)]
  end
  subgraph CAIPE Platform
    SUP -->|Orchestrates| AG[Sub-Agents]
  end
  SUP -->|Response stream| B
  B -->|Formatted reply| S
  S --> U
```

### Request Flow

1. User sends a message in Slack (via `@mention` or channel message)
2. Bot extracts the message text and thread context
3. Bot sends the message to the CAIPE supervisor via A2A `message/stream`
4. Supervisor orchestrates sub-agents (Jira, GitHub, ArgoCD, etc.)
5. Bot streams progress updates to Slack in real-time
6. Final response is posted with feedback buttons

---

## Features

- **Multi-agent per channel** — Bind multiple agents to a single channel, each with independent trigger rules
- **Listen modes** — Control when agents fire: `mention` (default for users), `message` (default for bots), or `all`
- **Bot message routing** — Route messages from other bots (e.g. alerting tools) to specific agents via `bot_list`
- **Overthink mode** — AI silently evaluates whether to respond, filtering out low-confidence answers
- **Escalation workflows** — VictorOps on-call pings, user @-mentions, and emoji reactions on "Get help"
- **Conversation continuity** — Thread-based context persistence across bot restarts (with MongoDB)
- **Human-in-the-Loop (HITL)** — Interactive Slack forms when the agent needs user input
- **Feedback scoring** — Thumbs up/down reactions tracked via Langfuse
- **Streaming responses** — Real-time progress updates during processing
- **OAuth2 for A2A** — Secure bot-to-supervisor communication with client credentials flow

---

## Prerequisites

### Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**, name your app (e.g., "CAIPE"), and select your workspace

### Bot Token Scopes

Under **OAuth & Permissions > Scopes > Bot Token Scopes**, add:

| Scope | Purpose |
|---|---|
| `app_mentions:read` | Detect @mentions of the bot |
| `channels:history` | Read messages in public channels the bot is in |
| `channels:read` | View basic channel information |
| `chat:write` | Send messages as the bot |
| `chat:write.customize` | Send messages with a customized username and avatar |
| `commands` | Register slash commands (future use) |
| `emoji:read` | View custom emoji in the workspace |
| `groups:history` | Read messages in private channels the bot is in |
| `groups:read` | View basic private channel information |
| `im:history` | Read direct messages with the bot |
| `im:read` | View basic DM information |
| `incoming-webhook` | Post to specific channels via webhook |
| `mpim:history` | Read group DMs the bot is in |
| `reactions:read` | View emoji reactions on messages |
| `reactions:write` | Add and remove emoji reactions |
| `users:read` | View people in the workspace |
| `users:read.email` | View email addresses of workspace members |

### Event Subscriptions

Under **Event Subscriptions > Subscribe to bot events**, add:

| Event | Required Scope | Description |
|---|---|---|
| `app_mention` | `app_mentions:read` | Messages that @mention the bot |
| `message.channels` | `channels:history` | Messages in public channels |
| `message.groups` | `groups:history` | Messages in private channels |
| `message.im` | `im:history` | Direct messages |
| `message.mpim` | `mpim:history` | Group direct messages |
| `reaction_added` | `reactions:read` | Emoji reactions added |
| `reaction_removed` | `reactions:read` | Emoji reactions removed |

### Enable Socket Mode (Recommended)

Under **Socket Mode**, toggle it on and generate an **App-Level Token** with the `connections:write` scope. This gives you an `xapp-...` token.

Socket mode is recommended because it:
- Requires no public URL or firewall rules
- Uses a persistent WebSocket connection (more reliable)
- Is simpler to set up for development

Alternatively, you can use HTTP mode with a signing secret (see [Connection Modes](#connection-modes)).

### Install the App

Under **Install App**, click **Install to Workspace** and authorize. Save the **Bot User OAuth Token** (`xoxb-...`).

---

## Configuration

### Environment Variables

#### Required

| Variable | Description |
|---|---|
| `CAIPE_URL` | CAIPE supervisor A2A endpoint |
| `SLACK_INTEGRATION_BOT_TOKEN` | Bot User OAuth Token (starts with `xoxb-`) |
| `SLACK_INTEGRATION_APP_TOKEN` | App-Level Token for Socket mode (starts with `xapp-`) |

#### Optional

| Variable | Default | Description |
|---|---|---|
| `SLACK_INTEGRATION_APP_NAME` | `CAIPE` | Display name used in bot responses |
| `SLACK_INTEGRATION_BOT_MODE` | `socket` | Connection mode: `socket` or `http` |
| `SLACK_INTEGRATION_SIGNING_SECRET` | — | Required only for HTTP mode |
| `SLACK_INTEGRATION_SILENCE_ENV` | `false` | Suppress environment info in bot responses |
| `SLACK_INTEGRATION_BOT_CONFIG` | — | YAML channel config (file path or inline YAML; see [Channel Config](#channel-configuration)) |
| `SLACK_INTEGRATION_DEFAULT_AGENT_ID` | — | Fallback agent for channels with no agent bindings |
| `SLACK_INTEGRATION_DM_AGENT_ID` | — | Agent used for DM conversations (falls back to default) |
| `SLACK_INTEGRATION_VICTOROPS_AGENT_ID` | — | Agent used for VictorOps on-call lookups during escalation |
| `MONGODB_URI` | — | MongoDB connection string for session persistence |
| `MONGODB_DATABASE` | `caipe` | MongoDB database name |
| `CAIPE_CONNECT_RETRIES` | `10` | Max connection attempts to supervisor on startup |
| `CAIPE_CONNECT_RETRY_DELAY` | `6` | Seconds between connection retries |

#### Langfuse Feedback Scoring

| Variable | Default | Description |
|---|---|---|
| `SLACK_INTEGRATION_LANGFUSE_ENABLED` | `false` | Enable feedback tracking via Langfuse |
| `LANGFUSE_PUBLIC_KEY` | — | Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | — | Langfuse project secret key |
| `LANGFUSE_HOST` | — | Langfuse server URL |

#### OAuth2 Authentication (Bot → Supervisor)

| Variable | Default | Description |
|---|---|---|
| `SLACK_INTEGRATION_ENABLE_AUTH` | `false` | Enable OAuth2 for A2A requests |
| `SLACK_INTEGRATION_AUTH_TOKEN_URL` | — | OAuth2 token endpoint |
| `SLACK_INTEGRATION_AUTH_CLIENT_ID` | — | OAuth2 client ID |
| `SLACK_INTEGRATION_AUTH_CLIENT_SECRET` | — | OAuth2 client secret (store in K8s Secret) |
| `SLACK_INTEGRATION_AUTH_SCOPE` | — | OAuth2 scope (optional) |
| `SLACK_INTEGRATION_AUTH_AUDIENCE` | — | OAuth2 audience (optional) |

### Channel Configuration

Per-channel behavior is controlled via `SLACK_INTEGRATION_BOT_CONFIG`, which accepts a file path or inline YAML string. Each channel maps to a list of agent bindings that control who triggers which agent.

```yaml
C012345678:
  name: "#platform-eng"
  agents:
    - agent_id: "my-agent"
      users:
        enabled: true
        listen: "mention"       # "mention" (default) | "message" | "all"
        overthink:
          enabled: false
      bots:
        enabled: true
        listen: "message"       # "message" (default) | "mention" | "all"
        bot_list: ["AlertBot"]  # null = all bots
      escalation:
        victorops:
          enabled: true
          team: "platform"
        users: ["U_ONCALL1"]
        emoji: { enabled: true, name: "eyes" }
        delete_admins: ["U_ADMIN1"]
```

#### Listen Modes

Each agent binding has independent `listen` settings for users and bots:

| Mode | Fires on | Default for |
|---|---|---|
| `mention` | `@bot` mentions only | `users` |
| `message` | Channel messages (non-mention) | `bots` |
| `all` | Both mentions and messages | — |

Multiple agents can match the same message — each fires independently.

#### Agent Binding Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `agent_id` | string | **required** | Agent to route messages to |
| `users.enabled` | bool | `true` | Respond to human messages |
| `users.listen` | string | `mention` | When to fire for users |
| `users.overthink.enabled` | bool | `false` | Filter low-confidence responses (see below) |
| `users.user_list` | list | `null` | Allowlist of Slack user IDs (`null` = all users) |
| `bots.enabled` | bool | `true` | Respond to bot messages |
| `bots.listen` | string | `message` | When to fire for bots |
| `bots.bot_list` | list | `null` | Allowlist of bot display names (`null` = all bots) |
| `escalation.victorops` | object | `{}` | VictorOps on-call lookup (requires `SLACK_INTEGRATION_VICTOROPS_AGENT_ID`) |
| `escalation.users` | list | `[]` | Slack user IDs to @-mention on escalation |
| `escalation.emoji` | object | `{}` | Emoji reaction to add on escalation |
| `escalation.delete_admins` | list | `[]` | Users allowed to delete bot messages |

### Overthink Mode

When `overthink.enabled: true`, the bot silently evaluates each message before responding:

1. The AI processes the message with a confidence-assessment prompt
2. If the response contains `DEFER` or `LOW_CONFIDENCE`, the bot **silently skips**
3. Otherwise the bot posts the response normally
4. If the user later @mentions the bot in the same thread, it detects the earlier skip and responds with context

Useful for busy channels where the bot should only speak when it has something genuinely helpful to say.

### Connection Modes

| Mode | Token Required | Use Case |
|---|---|---|
| **Socket** (default) | `SLACK_INTEGRATION_APP_TOKEN` (`xapp-...`) | Recommended. No public URL needed. Persistent WebSocket connection. |
| **HTTP** | `SLACK_INTEGRATION_SIGNING_SECRET` | Requires a public URL. Bot listens on port 3000 for incoming webhooks. |

---

## Deployment

### Docker Compose

The Slack bot is available as a Docker Compose profile:

```bash
# Start with the slack-bot profile
docker compose -f docker-compose.dev.yaml --profile slack-bot up

# Or combine with other profiles
docker compose -f docker-compose.dev.yaml --profile slack-bot --profile caipe-ui-with-mongodb up
```

Add the following to your `.env`:

```env
# Required
SLACK_INTEGRATION_BOT_TOKEN=xoxb-your-bot-token
SLACK_INTEGRATION_APP_TOKEN=xapp-your-app-token
SLACK_INTEGRATION_BOT_MODE=socket
SLACK_INTEGRATION_DEFAULT_AGENT_ID=my-agent

# Channel configuration (file path or inline YAML)
SLACK_INTEGRATION_BOT_CONFIG='
C012345678:
  name: "#your-channel"
  agents:
    - agent_id: "my-agent"
      users: { enabled: true, listen: "mention" }
'
```

### Helm Chart

The Slack bot ships as a subchart under `charts/slack-bot/`. It is enabled via the parent chart:

```yaml
# charts/ai-platform-engineering/values.yaml
tags:
  slack-bot: true
```

#### Helm Values

```yaml
# charts/slack-bot/values.yaml

replicaCount: 1

image:
  repository: ghcr.io/cnoe-io/caipe-slack-bot
  tag: ""           # Defaults to Chart.appVersion
  pullPolicy: Always

# Flat env var map → ConfigMap → envFrom
config:
  APP_NAME: "CAIPE"
  SLACK_BOT_MODE: "socket"
  CAIPE_API_URL: "http://ai-platform-engineering-caipe-ui:3000"
  SLACK_INTEGRATION_SILENCE_ENV: "false"
  # SLACK_INTEGRATION_DEFAULT_AGENT_ID: "my-agent"
  # SLACK_INTEGRATION_DM_AGENT_ID: "dm-agent"
  # SLACK_INTEGRATION_VICTOROPS_AGENT_ID: "victorops-agent"
  # MONGODB_URI: "mongodb://admin:changeme@mongodb:27017"
  # MONGODB_DATABASE: "caipe"

# Pre-existing K8s Secret containing Slack tokens
existingSecret: "slack-bot-secrets"

# Per-channel agent bindings (serialized as YAML into a ConfigMap)
botConfig: {}
  # C012345678:
  #   name: "#my-channel"
  #   agents:
  #     - agent_id: "my-agent"
  #       users: { enabled: true, listen: "mention" }
  #       bots: { enabled: false }
```

---

## Authentication

### Bot → Supervisor (OAuth2 Client Credentials)

When `auth.enabled: true`, the bot obtains a Bearer token using the OAuth2 client credentials flow and injects it into all A2A requests to the supervisor.

```
Bot                          IDP                         Supervisor
 |                            |                            |
 |--- POST /oauth2/token ---->|                            |
 |    client_id + secret      |                            |
 |<--- access_token ----------|                            |
 |                            |                            |
 |--- A2A message/stream ---->|                            |
 |    Authorization: Bearer   |--------------------------->|
 |                            |                            |
```

This works with any OIDC-compliant provider (Okta, Keycloak, Auth0, Azure AD). Tokens are cached and automatically refreshed before expiry.

**Configuration:**

```yaml
# Helm values
auth:
  enabled: true
  tokenUrl: "https://your-idp.example.com/oauth2/v1/token"
  clientId: "slack-bot-client"
  scope: "api://caipe"          # Optional
  audience: "caipe-supervisor"  # Optional
```

The `clientSecret` must be stored in the Kubernetes Secret referenced by `slack.tokenSecretRef`.

### Supervisor → Bot

The bot is a client only — it does not expose any HTTP endpoints (in Socket mode). There is no inbound authentication to configure.

---

## Session Persistence

The bot automatically selects a session backend:

| Backend | When Used | Persistence |
|---|---|---|
| **MongoDB** | `MONGODB_URI` is set | Sessions survive restarts. Recommended for production. |
| **In-memory** | `MONGODB_URI` not set | Sessions lost on restart. Fine for development. |

### What is Stored

| Data | Collection | Purpose |
|---|---|---|
| Thread → context_id | `slack_sessions` | Links Slack threads to A2A conversation contexts |
| Thread → trace_id | `slack_sessions` | Links threads to Langfuse traces for feedback |
| Thread → is_skipped | `slack_sessions` | Tracks overthink mode skip state |
| User info cache | `slack_users` | Avoids Slack API rate limits for user lookups |

All data is stored permanently (no TTL), matching the UI's conversation lifecycle. Sessions are only removed when explicitly deleted.

---

## Feedback & Scoring

When Langfuse is enabled, the bot attaches feedback buttons to every response:

- **Thumbs up** — Records positive feedback
- **Thumbs down** — Opens a refinement menu:
  - **Wrong answer** — Modal for correction details
  - **Too verbose** — Request concise response
  - **More detail** — Request additional search
  - **Other** — Generic feedback modal

Each feedback event is submitted to Langfuse as a score linked to the conversation trace, enabling quality analytics across channels.

---

## Human-in-the-Loop (HITL)

When the CAIPE supervisor's agents need user input (e.g., confirming a Jira ticket creation, selecting from options), the bot renders interactive Slack forms:

- Text inputs, dropdowns, multi-selects
- Action buttons (confirm, cancel, etc.)
- Form responses are sent back to the supervisor to continue the workflow

This enables workflows like: "Create a Jira ticket for this alert" → bot shows a form with pre-filled fields → user confirms → ticket is created.

---

## Local Development

```bash
# Navigate to the slack bot directory
cd ai_platform_engineering/integrations/slack_bot

# Run tests
make test

# Run linting
make lint

# Auto-fix linting issues
make lint-fix
```

To run the bot locally against a Docker Compose supervisor:

```bash
# Start the supervisor and MongoDB
docker compose -f docker-compose.dev.yaml --profile slack-bot up
```

The bot mounts the source code as a volume in development, so changes to the Python files take effect on restart.
