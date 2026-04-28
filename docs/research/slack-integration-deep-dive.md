# Slack Integration Deep Dive

> **Date:** April 2026
> **Purpose:** Technical research on how the Slack bot integrates with the CAIPE supervisor

---

## Overview

The CAIPE Slack bot is a **standalone Python application** (not embedded in the supervisor) that acts as a client bridge between Slack and the CAIPE multi-agent supervisor. It uses:

- **Slack Bolt** framework with **Socket Mode** for receiving Slack events
- **A2A protocol** (JSON-RPC 2.0 with SSE streaming) for communicating with the supervisor
- **Slack's plan streaming API** for rich, real-time response rendering

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  Slack Platform │◄───►│   Slack Bot     │◄───►│ CAIPE Supervisor│
│  (WebSocket)    │     │   (Python/Bolt) │     │ (A2A over SSE)  │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## 1. File Structure

### Core Bot Application (`ai_platform_engineering/integrations/slack_bot/`)

| File | Purpose |
|------|---------|
| `app.py` | **Main entry point.** Initializes the Slack Bolt app, registers all event handlers (`@app_mention`, `message`, actions, modals), sets up OAuth2, A2A client, session manager, and starts Socket/HTTP mode. |
| `a2a_client.py` | **A2A protocol client.** Implements JSON-RPC over SSE streaming to communicate with the CAIPE supervisor. Sends `message/stream` requests and parses SSE events. |
| `pyproject.toml` | Project dependencies: `slack-bolt`, `slack-sdk`, `requests`, `loguru`, `pydantic`, `pymongo`, `pyyaml`, `langfuse`. |

### Utility Modules (`ai_platform_engineering/integrations/slack_bot/utils/`)

| File | Purpose |
|------|---------|
| `ai.py` | **Core streaming logic.** `stream_a2a_response()` is the central function that sends messages to CAIPE via A2A, processes the SSE event stream, manages Slack streaming, handles overthink filtering, and posts final responses with feedback buttons. |
| `event_parser.py` | **A2A event classification.** Parses raw A2A events into typed `ParsedEvent` objects with `EventType` enum (12 types). |
| `slack_formatter.py` | **Slack Block Kit formatting.** Converts A2A plan steps to Slack `task_update` chunks, splits long text into blocks, formats error messages. |
| `slack_context.py` | **Thread context builder.** Fetches thread history, resolves user display names, builds formatted conversation context for multi-turn conversations. |
| `config.py` | Config loading entry point. Instantiates `Config.from_env()`. |
| `config_models.py` | **Pydantic config models.** Defines `Config`, `ChannelConfig`, `QandaConfig`, `AIAlertsConfig`, `GlobalDefaults`. Prompt templates with env var overrides. |
| `session_manager.py` | **Session storage abstraction.** Auto-selects MongoDB or in-memory backend. Stores `context_id`, `trace_id`, `is_skipped`, and cached user info. |
| `mongodb_session.py` | **MongoDB session store.** Persistent storage using `pymongo`. Survives restarts. |
| `oauth2_client.py` | **OAuth2 client credentials flow.** Fetches Bearer tokens from any OIDC provider for machine-to-machine auth with the supervisor. |
| `throttler.py` | **Slack API rate limiter.** Prevents 429 errors during streaming updates with minimum intervals and exponential backoff. |
| `hitl_handler.py` | **Human-in-the-Loop forms.** Parses `caipe_form` artifacts, renders as Slack Block Kit, handles submission, sends responses back to supervisor. |
| `langfuse_client.py` | **Langfuse feedback submission.** Creates categorical scores linked to conversation traces. |
| `scoring.py` | **Feedback scoring orchestrator.** Submits three Langfuse scores per feedback event (channel-specific, all-slack, all-clients). |
| `utils.py` | General utilities: `verify_thread_exists()`, `get_username_by_bot_id()`, `get_message_author_info()`. |

---

## 2. Slack Connection & Authentication

### Connection Modes

The bot uses **Slack Bolt** with two connection modes (`app.py`):

| Mode | Config | Token | Mechanism |
|------|--------|-------|-----------|
| **Socket Mode** (default) | `SLACK_INTEGRATION_BOT_MODE=socket` | `SLACK_INTEGRATION_APP_TOKEN` (`xapp-...`) | Persistent WebSocket via `SocketModeHandler`. No public URL needed. |
| **HTTP Mode** | `SLACK_INTEGRATION_BOT_MODE=http` | `SLACK_INTEGRATION_SIGNING_SECRET` | Bolt's built-in HTTP server on port 3000. Requires public URL. |

### Slack API Authentication

The bot authenticates to the Slack API using `SLACK_INTEGRATION_BOT_TOKEN` (`xoxb-...`) — the Bot User OAuth Token.

---

## 3. Supervisor Connection & Authentication

### A2A Protocol

The bot communicates with the CAIPE supervisor via the **A2A protocol** (JSON-RPC 2.0 over SSE):

```python
# a2a_client.py - send_message_stream()
POST {CAIPE_URL}
Content-Type: application/json
Accept: text/event-stream
X-Client-Source: slack-bot
X-Client-Channel: {channel_id}
Authorization: Bearer {token}  # if auth enabled

{
  "jsonrpc": "2.0",
  "method": "message/stream",
  "params": {
    "message": {
      "role": "user",
      "parts": [{"kind": "text", "text": "<prompt>"}],
      "messageId": "<uuid>",
      "contextId": "<from session or null>",
      "metadata": {"user_email": "..."}
    }
  },
  "id": <int>
}
```

The `A2AClient` uses `requests.post(..., stream=True)` and manually parses the SSE stream, yielding JSON-RPC result objects from `data:` lines.

### OAuth2 Client Credentials (Bot -> Supervisor)

When `SLACK_INTEGRATION_ENABLE_AUTH=true`:

1. `OAuth2ClientCredentials.from_env()` loads config from `SLACK_INTEGRATION_AUTH_*` env vars
2. On each A2A request, `A2AClient._get_headers()` calls `auth_client.get_access_token()`
3. Standard OAuth2 client credentials flow: `POST` to `token_url` with `client_id` + `client_secret`
4. Tokens are cached with 60-second refresh buffer before expiry
5. Token injected as `Authorization: Bearer <token>` on all A2A requests

Works with any OIDC provider (Okta, Keycloak, Auth0, Azure AD).

---

## 4. Message Flow

### Phase 1: Message Reception (Slack -> Bot)

```
Slack User
  │
  │ @mention, DM, or channel message
  ▼
Slack API (WebSocket)
  │
  ▼
slack_bolt.App  [app.py]
  │
  ├── @app.event("app_mention")  → handle_mention()
  ├── @app.event("message")      → handle_message_events()
  │     ├── channel_type=="im"   → handle_dm_message()
  │     ├── Q&A eligible         → handle_qanda_message()
  │     └── Bot alert            → handle_ai_alert_processing()
  │
  ├── @app.action("hitl_form_.*")     → handle_hitl_action()
  ├── @app.action("caipe_feedback")   → handle_caipe_feedback()
  └── @app.action("caipe_retry")      → handle_caipe_retry()
```

### Phase 2: Message Preprocessing

1. **Guard checks**: `verify_thread_exists()` confirms parent message exists
2. **Channel config**: Verify channel is configured in `SLACK_INTEGRATION_BOT_CONFIG`
3. **Message extraction**: `extract_message_text()` pulls text from blocks, attachments
4. **Thread context**: `build_thread_context()` fetches thread history, formats as conversation transcript
5. **Session lookup**: `session_manager.get_context_id(thread_ts)` retrieves A2A context
6. **Prompt construction**: Apply channel-specific template, append response style instruction

### Phase 3: A2A Communication (Bot -> Supervisor)

```
stream_a2a_response()  [utils/ai.py]
  │
  ▼
A2AClient.send_message_stream()  [a2a_client.py]
  │
  │ HTTP POST to CAIPE_URL with JSON-RPC
  │ Accept: text/event-stream
  │
  ▼
CAIPE Supervisor (SSE stream response)
```

### Phase 4: Stream Processing

Each SSE event is classified by `event_parser.parse_event()`:

| Event Type | Bot Behavior |
|------------|--------------|
| `TASK` | Store `context_id` in session, extract `trace_id` |
| `MESSAGE` | Capture as potential final content |
| `STATUS_UPDATE` | Log completion, capture errors |
| `STREAMING_RESULT` | Stream to Slack (final step) or accumulate silently (intermediate) |
| `EXECUTION_PLAN` | Render `task_update` chunks showing step progress |
| `TOOL_NOTIFICATION_START` | Update typing status ("is searching...") |
| `TOOL_NOTIFICATION_END` | Clear tool indicator |
| `FINAL_RESULT` | Capture as authoritative response (Priority 1) |
| `PARTIAL_RESULT` | Capture as fallback (Priority 2) |
| `CAIPE_FORM` | Render interactive Slack Block Kit form |

### Phase 5: Response Rendering (Bot -> Slack)

Two delivery modes depending on user type:

#### Streaming Mode (for real users)

```
1. assistant_threads_setStatus(status="is thinking...")
   → Shows animated typing indicator

2. chat_startStream(task_display_mode="plan")
   → Creates stream message, returns stream_ts

3. chat_appendStream(chunks=[...])
   → Updates plan card in real-time with task_update chunks
   → Streams markdown text via StreamBuffer

4. chat_stopStream(chunks, blocks)
   → Finalizes with remaining text + feedback buttons
```

#### Non-Streaming Fallback (for bot users/alerts)

```
1. chat_postMessage(blocks=["CAIPE is working..."])
2. chat_update(blocks=[progress]) via throttler (1.5s intervals)
3. chat_delete(ts=response_ts)
4. chat_postMessage(blocks=[final response + footer])
```

---

## 5. Plan Streaming Architecture

The bot uses Slack's **plan streaming API** (`task_display_mode="plan"`) for a single message that progressively shows:

1. **Task update cards** — plan steps with status indicators
2. **Streamed markdown text** — the final answer
3. **Final blocks** — feedback buttons, footer

### Plan Step Updates

When A2A sends `EXECUTION_PLAN` events:
- Steps tracked in `plan_steps` dict (keyed by `step_id`)
- Only **changed** steps sent to Slack
- Status mapping: `pending→pending`, `in_progress→in_progress`, `completed→complete`, `failed→error`
- Accumulated "thinking" text attached as `details` when step completes (truncated to 500 chars)

### Text Streaming Strategy

- **Intermediate plan steps**: Text accumulated silently in `step_thinking[step_id]`
- **Final plan step**: Once last step starts streaming, `streaming_final_answer` flag enables real-time streaming to Slack
- **No-plan flows**: All `STREAMING_RESULT` text streamed immediately

### StreamBuffer

The `StreamBuffer` class batches markdown text:
- Flushes on **newline boundaries** to avoid splitting mid-markdown
- Safety-net flush at 1-second intervals
- Uses `chat_appendStream` with `{"type": "markdown_text", "text": ...}` chunks

---

## 6. Session Continuity

`SessionManager` provides pluggable session storage:

| Backend | Use Case | Storage |
|---------|----------|---------|
| `MongoDBSessionStore` | Production | `slack_sessions` and `slack_users` collections |
| `InMemorySessionStore` | Dev/Test | Dictionary |

Stores per thread:
- `context_id` — A2A conversation continuity
- `trace_id` — Langfuse feedback linking
- `is_skipped` — Overthink mode flag

---

## 7. Human-in-the-Loop (HITL) Forms

When A2A sends `caipe_form` artifacts:

1. `hitl_handler.parse_form_data()` extracts form definition
2. `format_hitl_form_blocks()` renders as Slack Block Kit:
   - Text inputs
   - Dropdowns (static_select)
   - Action buttons (Submit/Cancel)
3. User interacts with form in Slack
4. `handle_hitl_action()` captures submission
5. `HITLCallbackHandler.submit_form_response()` sends response back to supervisor via A2A

---

## 8. Feedback System

### Slack UI

Final responses include:
- **Refinement buttons**: "Not enough detail" / "Too verbose"
- **Thumbs up/down**: Opens modal for optional comments
- **"Wrong Answer" modal**: Free-form feedback with optional email

### Langfuse Scoring

`submit_feedback_score()` creates **three scores** per feedback:
1. Channel-specific score (e.g., `slack-channel-C123456`)
2. All Slack channels (`slack-all-channels`)
3. Cross-client (`all`)

Each score linked to the conversation trace via `trace_id` from session.

---

## 9. Error Handling & Resilience

### Graceful Degradation

If a task fails but partial content was received, the bot **still shows the content** with a warning. If no content AND error occurred, displays a "Retry" button.

### Content Priority

Final response text selection:
1. `FINAL_RESULT` artifact (authoritative)
2. `PARTIAL_RESULT` artifact (fallback)
3. Last `MESSAGE` with `role=agent`
4. Text from any `OTHER_ARTIFACT`
5. Fallback: "I've completed your request."

### Startup Retries

Bot retries connecting to supervisor on startup:
- `CAIPE_CONNECT_RETRIES` (default: 10)
- `CAIPE_CONNECT_RETRY_DELAY` (default: 6 seconds)

---

## 10. Configuration Reference

### Required

| Variable | Purpose |
|----------|---------|
| `CAIPE_URL` | CAIPE supervisor A2A endpoint |
| `SLACK_INTEGRATION_BOT_TOKEN` | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_INTEGRATION_APP_TOKEN` | App-Level Token for Socket Mode (`xapp-...`) |
| `SLACK_INTEGRATION_BOT_CONFIG` | YAML channel configuration |

### Connection & Identity

| Variable | Default | Purpose |
|----------|---------|---------|
| `SLACK_INTEGRATION_APP_NAME` | `CAIPE` | Display name in messages |
| `SLACK_INTEGRATION_BOT_MODE` | `socket` | `socket` or `http` |
| `SLACK_INTEGRATION_SIGNING_SECRET` | — | Required for HTTP mode |

### Session & Database

| Variable | Default | Purpose |
|----------|---------|---------|
| `MONGODB_URI` | — | MongoDB URI for persistent sessions |
| `MONGODB_DATABASE` | `caipe` | MongoDB database name |

### OAuth2 (Bot -> Supervisor)

| Variable | Default | Purpose |
|----------|---------|---------|
| `SLACK_INTEGRATION_ENABLE_AUTH` | `false` | Enable OAuth2 |
| `SLACK_INTEGRATION_AUTH_TOKEN_URL` | — | OIDC token endpoint |
| `SLACK_INTEGRATION_AUTH_CLIENT_ID` | — | Client ID |
| `SLACK_INTEGRATION_AUTH_CLIENT_SECRET` | — | Client secret |
| `SLACK_INTEGRATION_AUTH_SCOPE` | — | Optional scope |
| `SLACK_INTEGRATION_AUTH_AUDIENCE` | — | Optional audience |

### Langfuse Feedback

| Variable | Default | Purpose |
|----------|---------|---------|
| `SLACK_INTEGRATION_LANGFUSE_ENABLED` | `false` | Enable feedback scoring |
| `LANGFUSE_PUBLIC_KEY` | — | Langfuse project key |
| `LANGFUSE_SECRET_KEY` | — | Langfuse secret |
| `LANGFUSE_HOST` | — | Langfuse server URL |
| `SLACK_WORKSPACE_URL` | — | For Slack permalinks in Langfuse |

### Prompt Overrides

| Variable | Purpose |
|----------|---------|
| `SLACK_INTEGRATION_PROMPT_RESPONSE_STYLE` | Response style instruction |
| `SLACK_INTEGRATION_PROMPT_QANDA` | Default Q&A prompt |
| `SLACK_INTEGRATION_PROMPT_OVERTHINK_QANDA` | Overthink Q&A prompt |
| `SLACK_INTEGRATION_PROMPT_MENTION` | @mention prompt |
| `SLACK_INTEGRATION_PROMPT_HUMBLE_FOLLOWUP` | Humble followup prompt |
| `SLACK_INTEGRATION_PROMPT_AI_ALERTS` | AI alert processing prompt |

---

## 11. Key Classes

| Class | File | Role |
|-------|------|------|
| `A2AClient` | `a2a_client.py` | JSON-RPC A2A protocol client with SSE streaming |
| `StreamBuffer` | `utils/ai.py` | Batches markdown text for Slack appendStream |
| `ParsedEvent` | `utils/event_parser.py` | Classified A2A event with extracted fields |
| `EventType` | `utils/event_parser.py` | Enum of 12 event types |
| `Config`, `ChannelConfig` | `utils/config_models.py` | Pydantic config hierarchy |
| `SessionManager` | `utils/session_manager.py` | Pluggable session storage facade |
| `MongoDBSessionStore` | `utils/mongodb_session.py` | Production session backend |
| `OAuth2ClientCredentials` | `utils/oauth2_client.py` | OAuth2 client credentials with token caching |
| `SlackUpdateThrottler` | `utils/throttler.py` | Rate-limited Slack message updater |
| `HITLForm` | `utils/hitl_handler.py` | HITL form data model |

---

## 12. Key Functions

| Function | File | Role |
|----------|------|------|
| `stream_a2a_response()` | `utils/ai.py` | Central orchestrator: send A2A, process stream, render to Slack |
| `parse_event()` | `utils/event_parser.py` | Classify raw A2A events |
| `build_thread_context()` | `utils/slack_context.py` | Build conversation transcript from thread history |
| `extract_message_text()` | `utils/slack_context.py` | Extract text from Slack events |
| `build_task_update_chunks()` | `utils/slack_formatter.py` | Convert plan steps to Slack chunks |
| `submit_feedback_score()` | `utils/scoring.py` | Submit 3 Langfuse scores per feedback |
| `verify_thread_exists()` | `utils/utils.py` | Guard against replying to deleted threads |
| `parse_form_data()` | `utils/hitl_handler.py` | Parse HITL form from A2A artifact |

---

## 13. Deployment

### Docker Compose

```yaml
# docker-compose.dev.yaml
slack-bot:
  image: ghcr.io/cnoe-io/caipe-slack-bot
  ports:
    - "8030:3000"  # Only used in HTTP mode
  profiles:
    - slack-bot
    - all-integrations
  depends_on:
    - caipe-supervisor
    - caipe-mongodb
  volumes:
    - ./ai_platform_engineering/integrations/slack_bot:/app  # Hot reload (dev)
```

### Helm Chart

Located at `charts/ai-platform-engineering/charts/slack-bot/` with:
- Deployment
- Service
- ConfigMap
- ExternalSecret templates

---

## Summary

The CAIPE Slack Bot:

1. **Connects to Slack** via Socket Mode (WebSocket) using Slack Bolt
2. **Authenticates to supervisor** via OAuth2 client credentials (optional)
3. **Sends messages** to supervisor using A2A protocol (JSON-RPC over SSE)
4. **Processes SSE events** classifying them into 12 types (plans, streaming text, forms, etc.)
5. **Renders responses** using Slack's plan streaming API with real-time plan steps and markdown
6. **Maintains session** via MongoDB for conversation continuity across restarts
7. **Collects feedback** via interactive buttons and submits to Langfuse
