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

- **@Mention responses** — Mention the bot in any channel to get AI assistance
- **Q&A mode** — Auto-respond to channel messages without requiring a mention (per-channel opt-in)
- **Overthink mode** — AI silently evaluates whether to respond, filtering out low-confidence answers
- **AI alert processing** — Route bot alerts to Jira ticket creation with AI analysis
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
| `SLACK_INTEGRATION_BOT_CONFIG` | — | YAML channel configuration (see [Channel Config](#channel-configuration)) |
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

Per-channel behavior is controlled via the `SLACK_INTEGRATION_BOT_CONFIG` environment variable, which accepts a YAML string.

```yaml
# Channel ID → configuration mapping
C012345678:
  name: "#platform-eng"
  ai_enabled: true
  qanda:
    enabled: true          # Auto-respond without @mention
    overthink: true        # Filter low-confidence responses
    include_bots:
      enabled: false       # Process messages from other bots
      bot_list: []         # Specific bot IDs to process
    custom_prompt: ""      # Override the default Q&A prompt
  ai_alerts:
    enabled: false         # Route bot alerts to Jira
    custom_prompt: ""      # Override the default alert prompt
  default:
    project_key: "PROJ"    # Jira project for ticket creation
    issue_type: "Bug"      # Jira issue type
    additional_fields:
      labels:
        - "ai-detected"
```

#### Channel Options

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | string | — | Human-readable channel name (for logging) |
| `ai_enabled` | bool | `false` | Whether the bot responds in this channel at all |
| `qanda.enabled` | bool | `false` | Auto-respond to messages without @mention |
| `qanda.overthink` | bool | `false` | Use low-confidence filtering (see [Overthink Mode](#overthink-mode)) |
| `qanda.include_bots.enabled` | bool | `false` | Process messages from other bots |
| `qanda.include_bots.bot_list` | list | `[]` | Specific bot IDs to process (empty = all bots) |
| `qanda.custom_prompt` | string | — | Override the default Q&A system prompt |
| `ai_alerts.enabled` | bool | `false` | Route bot alert messages to AI for Jira triage |
| `ai_alerts.custom_prompt` | string | — | Override the default alert processing prompt |
| `default.project_key` | string | — | Jira project key for ticket creation |
| `default.issue_type` | string | `Bug` | Jira issue type for created tickets |
| `default.additional_fields` | object | `{}` | Extra Jira fields (labels, components, etc.) |

:::warning
`ai_alerts.enabled` and `qanda.include_bots.enabled` cannot both be `true` on the same channel. AI alerts already process bot messages, so enabling both would cause conflicts.
:::

### Overthink Mode

When `qanda.overthink: true` is set, the bot silently evaluates each message before responding:

1. The AI processes the message with a special prompt that asks it to assess confidence
2. If the response contains `[DEFER]` or `[LOW_CONFIDENCE]` — the bot **silently skips** the message
3. If the response contains `[CONFIDENCE: HIGH]` — the bot posts the response
4. If the user later @mentions the bot in the same thread, it detects the earlier skip and provides a response acknowledging the context

This is useful for busy channels where you want the bot to only speak up when it has something genuinely helpful to say.

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

# Channel configuration
SLACK_INTEGRATION_BOT_CONFIG='
C012345678:
  name: "#your-channel"
  ai_enabled: true
  qanda:
    enabled: true
    overthink: true
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
  repository: ghcr.io/cnoe-io/slack-bot
  tag: ""           # Defaults to Chart.appVersion
  pullPolicy: Always

# Display name in Slack messages
appName: "CAIPE"

# Connection mode: "socket" or "http"
botMode: "socket"

# Environment variables passed to the bot
env:
  CAIPE_URL: "http://ai-platform-engineering-supervisor-agent:8000"
  # LANGFUSE_SCORING_ENABLED: "true"
  # LANGFUSE_PUBLIC_KEY: ""
  # LANGFUSE_HOST: ""

# Reference to a Kubernetes Secret containing Slack tokens
slack:
  tokenSecretRef: "slack-bot-secrets"

# MongoDB for session persistence
mongodb:
  uri: ""           # e.g. "mongodb://admin:changeme@ai-platform-engineering-mongodb:27017"
  database: "caipe"

# OAuth2 client credentials for A2A requests to the supervisor
auth:
  enabled: false
  tokenUrl: ""      # e.g. "https://your-idp.example.com/oauth2/v1/token"
  clientId: ""
  scope: ""         # Optional
  audience: ""      # Optional
  # clientSecret should be stored in the K8s Secret (slack.tokenSecretRef), NOT here

# Suppress environment info in responses
silenceEnv: "false"

# Per-channel config (serialized as YAML into a ConfigMap)
botConfig: {}
  # C012345678:
  #   name: "#my-channel"
  #   ai_enabled: true
  #   qanda:
  #     enabled: true

externalSecrets:
  enabled: false
  apiVersion: "v1beta1"
  secretStoreRef:
    name: "vault"
    kind: "ClusterSecretStore"
  data: []
    # - secretKey: SLACK_BOT_TOKEN
    #   remoteRef:
    #     key: prod/slack-bot
    #     property: bot_token

resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi
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
