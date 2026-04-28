# Slack Bot Migration to Dynamic Agents — Implementation Plan

## Overview

Migrate the CAIPE Slack bot from the **supervisor (A2A protocol)** to **dynamic agents (AG-UI protocol)** for release 0.4.0. The supervisor is deprecated in 0.4.0; the Slack bot will exclusively use dynamic agents.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Slack conversations in web UI | **No** — keep separate | Simpler implementation, no metadata endpoint calls needed |
| Conversation ID strategy | **Deterministic from `thread_ts`** | UUID v5 from thread_ts — no lookup API needed, follow-ups reuse same ID |
| A2A/supervisor code | **Remove entirely** | Supervisor deprecated in 0.4.0, no reason to maintain dual paths |
| Streaming vs invoke | **Both** — streaming default, invoke fallback | Streaming for real users (U/W prefix), invoke for bot users (B prefix) |
| Agent config scope | **`agent_id` only** | Single `DYNAMIC_AGENTS_URL` env var, channels specify which agent |

## Current Architecture (What Exists)

### Slack Bot File Structure

```
ai_platform_engineering/integrations/slack_bot/
├── app.py                    # Entry point: event handlers, bot init
├── a2a_client.py             # A2A JSON-RPC client (TO BE DELETED)
├── sse_client.py             # AG-UI SSE client (TO BE REWRITTEN)
├── pyproject.toml            # Dependencies
├── utils/
│   ├── ai.py                 # Streaming handler — stream_a2a_response (TO BE REWRITTEN)
│   ├── event_parser.py       # A2A artifact classifier (TO BE DELETED)
│   ├── config.py             # Config loader
│   ├── config_models.py      # Pydantic models for YAML config
│   ├── session_manager.py    # Context ID caching + supervisor lookup
│   ├── slack_formatter.py    # Slack Block Kit formatting
│   ├── slack_context.py      # Thread context builder
│   ├── scoring.py            # Feedback via POST /api/feedback
│   ├── hitl_handler.py       # HITL form rendering + callback handling
│   ├── escalation.py         # VictorOps/user ping/emoji escalation
│   ├── oauth2_client.py      # OAuth2 client credentials auth
│   └── utils.py              # Thread verification, user info lookup
└── tests/
    └── ...
```

### Current Flow (A2A — Being Replaced)

```
User sends Slack message (@mention, DM, Q&A)
    ↓
app.py event handler extracts text, user info, thread context
    ↓
session_manager.get_context_id(thread_ts)
    → GET /api/v1/conversations/lookup?source=slack&thread_ts=... (supervisor API)
    ↓
a2a_client.send_message_stream() → POST / (JSON-RPC method: message/stream)
    ↓
Supervisor processes via A2A protocol, returns SSE stream
    ↓
ai.py:stream_a2a_response() parses artifact-update events:
    - streaming_result, final_result, tool_notification_start/end, execution_plan, caipe_form
    ↓
Slack streaming API: startStream → appendStream (text + plan steps) → stopStream
```

### Known Issues on Our Branch

1. `app.py` calls `ai.stream_sse_response()` but `ai.py` only defines `stream_a2a_response()` — **broken naming from merge**
2. `throttler.py` was removed by commit `02525bea` but `ai.py` still imports it — **import error**
3. `app.py` passes `SSEClient` but `ai.py` expects `A2AClient` with `send_message_stream()` — **interface mismatch**

These are all pre-existing issues from the merge of `main` into `release/0.4.0`. This migration fixes all of them.

## Target Architecture (Dynamic Agents)

### New Flow

```
User sends Slack message (@mention, DM, Q&A)
    ↓
app.py event handler extracts text, user info, thread context
    ↓
conversation_id = uuid5(NAMESPACE_URL, f"slack:{thread_ts}")  # deterministic, no lookup
agent_id = channel_config.agent_id                            # from YAML config
    ↓
For real users (U/W prefix): streaming path
    sse_client.stream_chat() → POST /api/v1/chat/stream/start?protocol=agui
        body: { message, conversation_id, agent_id }
    ↓
    AG-UI SSE events: TEXT_MESSAGE_*, TOOL_CALL_*, STATE_*, RUN_FINISHED/ERROR
    ↓
    ai.py:stream_response() maps AG-UI events to Slack streaming API

For bot users (B prefix): invoke path
    sse_client.invoke() → POST /api/v1/chat/invoke
        body: { message, conversation_id, agent_id }
    ↓
    Synchronous JSON response: { success, content, agent_id, conversation_id }
    ↓
    ai.py:invoke_response() posts content via chat_postMessage
```

### Dynamic Agents Endpoints Used

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/chat/stream/start?protocol=agui` | Start streaming chat (primary) |
| `POST /api/v1/chat/stream/resume?protocol=agui` | Resume after HITL interrupt |
| `POST /api/v1/chat/invoke` | Non-streaming fallback for bot users |
| `GET /healthz` | Health check on startup |
| `GET /api/v1/conversations/{id}/todos?agent_id=...` | Fetch plan/todos (optional, post-stream) |

### AG-UI Event → Slack Mapping

| AG-UI Event | Slack Action |
|---|---|
| `TEXT_MESSAGE_START` | Start stream if not started (`chat_startStream`) |
| `TEXT_MESSAGE_CONTENT` | `StreamBuffer.append(delta)` → `chat_appendStream` |
| `TEXT_MESSAGE_END` | Flush buffer |
| `TOOL_CALL_START` | `chat_appendStream` with `task_update` chunk (status: in_progress) |
| `TOOL_CALL_END` | `chat_appendStream` with `task_update` chunk (status: complete) |
| `STATE_DELTA` / `STATE_SNAPSHOT` | Extract todos for plan step display |
| `RUN_FINISHED` (outcome=success) | `chat_stopStream` with feedback + footer blocks |
| `RUN_FINISHED` (outcome=interrupt) | Render HITL form (Block Kit) |
| `RUN_ERROR` | Error blocks via `chat_stopStream` or `chat_postMessage` |
| `STEP_STARTED` / `STEP_FINISHED` | Log only (no Slack rendering) |
| `CUSTOM` | Log only (future extension point) |

### HITL (Human-in-the-Loop) Flow

```
Agent calls request_user_input(prompt, fields)
    ↓
LangGraph middleware intercepts → creates interrupt in checkpoint
    ↓
Runtime detects interrupt after stream loop ends
    ↓
Encoder emits: RUN_FINISHED { outcome: "interrupt", interrupt: { id, reason, payload } }
    ↓
Slack bot parses interrupt payload:
    - interrupt.id → tool_call_id (for resume correlation)
    - interrupt.payload.prompt → form description
    - interrupt.payload.fields → form field definitions
    ↓
Slack bot renders Block Kit form in thread:
    - text → plain_text_input
    - select → static_select
    - multiselect → multi_static_select
    - boolean → button pair (Yes/No)
    - number/url/email → plain_text_input with placeholder
    ↓
User submits form → action handler collects values
    ↓
POST /api/v1/chat/stream/resume
    body: { agent_id, conversation_id, form_data: JSON.stringify(values) }
    ↓
Backend resumes LangGraph with populated field values → new SSE stream
    ↓
Slack bot processes the resume stream with same stream_response() handler

User dismisses form →
    POST /api/v1/chat/stream/resume
    body: { ..., form_data: "User dismissed the input form without providing values." }
```

### Conversation ID Strategy

```python
import uuid

# Fixed namespace for Slack thread → conversation_id mapping
SLACK_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "slack.caipe.io")

def thread_ts_to_conversation_id(thread_ts: str) -> str:
    """Deterministic conversation_id from Slack thread timestamp.

    Same thread_ts always produces the same UUID v5. No lookup API needed.
    Follow-up messages in the same thread reuse the same conversation_id,
    which maps to the same LangGraph thread_id on the backend.
    """
    return str(uuid.uuid5(SLACK_NAMESPACE, thread_ts))
```

### Feedback Flow (Unchanged)

Feedback is backend-agnostic — it goes through the UI's feedback API:

```
User clicks 👍/👎 → Slack action handler
    ↓
scoring.py:submit_feedback_score()
    → POST {CAIPE_UI_URL}/api/feedback
    body: {
        conversationId: deterministic_uuid,  # used as Langfuse traceId
        feedbackType: "like" | "dislike",
        value: "thumbs_up" | "thumbs_down" | "needs_detail" | ...,
        source: "slack",
        channelId, threadTs, userId, userEmail, slackPermalink
    }
```

The feedback API uses `conversationId` as the Langfuse trace identifier (priority: `conversationId > traceId > messageId`). Since dynamic agents also uses `conversation_id` as the LangGraph `thread_id` and Langfuse grouping key, this aligns perfectly.

### Authentication

The dynamic agents backend requires JWT Bearer tokens via OIDC. The Slack bot's existing `OAuth2ClientCredentials` client can be reused if the OIDC provider issues JWTs with the correct audience.

- Dev mode: `AUTH_ENABLED=false` on dynamic agents → all requests get admin access (no token needed)
- Production: Slack bot's OAuth2 client credentials grant must produce a JWT accepted by dynamic agents

### Channel Configuration

```yaml
# SLACK_INTEGRATION_BOT_CONFIG (YAML)
C12345ABC:
  name: "platform-support"
  ai_enabled: true
  agent_id: "platform-engineer"     # Required — dynamic agent config ID
  custom_prompt: "You are helping..."
  qanda:
    enabled: true
    overthink: false

C67890DEF:
  name: "code-review"
  ai_enabled: true
  agent_id: "code-reviewer"         # Different agent per channel
  qanda:
    enabled: true
```

## Implementation Phases

### Phase 1: Foundation — Client & Config

**Commit scope**: New client, updated config, delete A2A code.

#### 1a. Rewrite `sse_client.py`

- Fix endpoint URL: `POST /api/v1/chat/stream/start` (was `/chat/stream`)
- Add `?protocol=agui` query param
- Request body: `{ message, conversation_id, agent_id }` — the backend expects `ChatRequest`, not AG-UI `RunAgentInput`
- Add `resume_stream()` method → `POST /api/v1/chat/stream/resume`
- Add `invoke()` method → `POST /api/v1/chat/invoke` (non-streaming, returns JSON)
- Keep `auth_client` support for OAuth2 Bearer tokens
- Keep `X-Client-Source: slack-bot` header
- Conversation ID helper: `thread_ts_to_conversation_id()`

#### 1b. Update `config_models.py`

- Add `agent_id: str` to `ChannelConfig` (required field)
- Keep all existing fields (qanda, ai_alerts, escalation, etc.)

#### 1c. Delete `a2a_client.py`

Completely removed — no A2A protocol support.

### Phase 2: Streaming Handler

**Commit scope**: New streaming handler, delete A2A handler.

#### 2a. Rewrite `utils/ai.py`

Replace `stream_a2a_response` (1100 lines) with:

- `stream_response()` — handles AG-UI SSE events, maps to Slack streaming API
  - Reuses `StreamBuffer` (protocol-agnostic, no changes)
  - Reuses `_build_stream_final_blocks()` (feedback + footer blocks)
  - Reuses `_post_final_response()` (non-streaming fallback)
  - New: map `TOOL_CALL_START/END` to Slack `task_update` chunks
  - New: handle `RUN_FINISHED` with `outcome: "interrupt"` → delegate to HITL
  - New: extract todos from `STATE_DELTA`/`STATE_SNAPSHOT` for plan display

- `invoke_response()` — non-streaming fallback for bot users
  - Calls `sse_client.invoke()`
  - Posts response as `chat_postMessage` with feedback blocks

- Keep `handle_ai_alert_processing()` — updated to use new client
- Keep `RETRY_PROMPT_PREFIX`, `_build_footer_text()`, `_check_overthink_skip()`

#### 2b. Delete `utils/event_parser.py`

Completely removed — AG-UI events are typed by `SSEEventType` enum in `sse_client.py`.

#### 2c. Remove `throttler` import

Dead code — throttler was used for bot-user polling in A2A flow. The invoke path doesn't need it.

### Phase 3: HITL Support

**Commit scope**: Updated HITL handler for AG-UI interrupt format.

#### 3a. Update `utils/hitl_handler.py`

- New function: `parse_agui_interrupt()` — parses `RUN_FINISHED` interrupt payload
- Map field types to Slack Block Kit elements (see mapping table above)
- Store `interrupt_id`, `conversation_id`, `agent_id` in button action values
- Render form via `chat_postMessage` (not streaming — forms are static)

#### 3b. Update `app.py` — HITL action handlers

- On form submit: collect values → JSON → `POST /api/v1/chat/stream/resume`
- Resume response is a new SSE stream → process with `stream_response()`
- On dismiss: resume with rejection message

### Phase 4: App.py Rewiring

**Commit scope**: Update all event handlers, session manager, health check.

#### 4a. Initialization

- Replace `CAIPE_URL`/`SUPERVISOR_SSE_URL` with `DYNAMIC_AGENTS_URL`
- Health check: `GET /healthz` (not `/chat/stream/health`)
- Remove A2A-specific imports

#### 4b. Event handlers

- `handle_mention()`, `handle_dm_message()`, `handle_qanda_message()`:
  - Get `agent_id` from `channel_config.agent_id`
  - Generate `conversation_id` from `thread_ts` (deterministic)
  - Stream or invoke based on user ID prefix
- Feedback handlers: "More detail", "Briefer", "Wrong answer", "Retry" — same flow with new client
- Alert processing: same flow with `agent_id` from channel config

#### 4c. Simplify `utils/session_manager.py`

- Remove supervisor API lookup (`GET /api/v1/conversations/lookup`)
- `get_context_id(thread_ts)` → returns deterministic UUID (no API call)
- `set_context_id()` → no-op or removed
- Keep TTL caches for trace_id, user_info, skipped, escalated (pure in-memory)

### Phase 5: Docker & Config

**Commit scope**: Deployment config updates.

#### 5a. Docker Compose

- `docker-compose.dev.yaml`: `slack-bot` depends on `dynamic-agents` instead of `caipe-supervisor`
- Environment: `DYNAMIC_AGENTS_URL=http://dynamic-agents:8100`
- Remove `CAIPE_URL` / `SUPERVISOR_SSE_URL`
- Keep `CAIPE_UI_URL` for feedback API
- `docker-compose.yaml`: same changes for production

#### 5b. `pyproject.toml`

- Version bump to `0.4.0`

### Phase 6: Tests

**Commit scope**: Test updates.

- Replace A2A streaming tests with AG-UI streaming tests
- Update config tests for `agent_id` field
- Keep feedback tests (path unchanged)
- Remove A2A-specific test data and fixtures
- Delete `test_a2a_client.py`, `test_a2a_streaming.py`

## Files Changed Summary

| Action | File | Notes |
|---|---|---|
| **Rewrite** | `sse_client.py` | New endpoints, request format, resume/invoke |
| **Rewrite** | `utils/ai.py` | New `stream_response()` + `invoke_response()` |
| **Update** | `utils/config_models.py` | Add `agent_id` to `ChannelConfig` |
| **Update** | `utils/hitl_handler.py` | AG-UI interrupt format |
| **Simplify** | `utils/session_manager.py` | Deterministic conversation_id |
| **Update** | `app.py` | New client init, agent_id routing, health check |
| **Update** | `docker-compose.dev.yaml` | Service deps, env vars |
| **Update** | `docker-compose.yaml` | Service deps, env vars |
| **Update** | `pyproject.toml` | Version bump |
| **Delete** | `a2a_client.py` | A2A protocol removed |
| **Delete** | `utils/event_parser.py` | A2A artifact parser removed |
| **Update** | `tests/` | Replace A2A tests with AG-UI tests |

## Environment Variables

| Variable | Old | New |
|---|---|---|
| `DYNAMIC_AGENTS_URL` | — | `http://dynamic-agents:8100` (new, required) |
| `CAIPE_URL` | `http://caipe-supervisor:8000` | **Removed** |
| `SUPERVISOR_SSE_URL` | `http://caipe-supervisor:8000` | **Removed** |
| `CAIPE_UI_URL` | `http://caipe-ui:3000` | Unchanged (feedback API) |
| `SLACK_INTEGRATION_BOT_CONFIG` | YAML without `agent_id` | YAML with `agent_id` per channel (required) |
| `SLACK_INTEGRATION_ENABLE_AUTH` | `false` | Unchanged (OAuth2 for dynamic agents auth) |

## Key Discoveries

1. **conversation_id = threadId = thread_id** — single UUID flows through the entire system under different names. UI creates it; backend never generates one. Slack bot will create it deterministically from `thread_ts`.

2. **trace_id is not emitted in SSE events** — the feedback API uses `conversationId` as the Langfuse trace identifier. No changes needed.

3. **HITL uses `RUN_FINISHED` with `outcome: "interrupt"`** in AG-UI protocol. The interrupt payload contains `id`, `prompt`, and `fields`. Resume via `POST /api/v1/chat/stream/resume` with JSON form data.

4. **`/chat/invoke` exists** for non-streaming responses — ideal for bot users (B-prefix IDs) that can't use Slack's streaming API.

5. **Dynamic agents auth** requires JWT Bearer tokens or `AUTH_ENABLED=false` bypass. The Slack bot's existing OAuth2 client can be reused if the OIDC provider issues JWTs with the correct audience.

6. **The `sse_client.py` on our branch** already has the AG-UI event types and parsing logic from the earlier AG-UI unification work. It just needs updated endpoint URLs and request format.
