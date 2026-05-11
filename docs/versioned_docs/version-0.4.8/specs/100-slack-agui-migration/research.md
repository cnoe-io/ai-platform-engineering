# Research: Slack Bot AG-UI Migration

**Date**: 2026-04-14
**Spec**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

## Research Questions

### R1: AG-UI Protocol Event Types and Payloads

**Decision**: Use the AG-UI SSE protocol as implemented by `AGUIStreamEncoder` in the dynamic agents backend.

**Rationale**: The AG-UI encoder is already production-ready, serving the web UI. The Slack bot's existing `sse_client.py` already defines the correct `SSEEventType` enum. The event format is stable and well-documented in the encoder source.

**Event types emitted by the dynamic agents backend** (from `agui_sse.py`):

| Event Type | When Emitted | Payload Fields |
|---|---|---|
| `RUN_STARTED` | Once at stream start | `runId`, `threadId`, `timestamp` |
| `TEXT_MESSAGE_START` | First content chunk per namespace | `messageId`, `role: "assistant"`, `timestamp` |
| `TEXT_MESSAGE_CONTENT` | Each text token | `messageId`, `delta`, `timestamp` |
| `TEXT_MESSAGE_END` | End of text sequence | `messageId`, `timestamp` |
| `TOOL_CALL_START` | AIMessage with tool_calls | `toolCallId`, `toolCallName`, `timestamp` |
| `TOOL_CALL_ARGS` | Immediately after TOOL_CALL_START | `toolCallId`, `delta` (truncated JSON args), `timestamp` |
| `TOOL_CALL_END` | ToolMessage arrives | `toolCallId`, `timestamp` |
| `RUN_FINISHED` (success) | Stream completes normally | `runId`, `threadId`, `outcome: "success"`, `timestamp` |
| `RUN_FINISHED` (interrupt) | HITL input requested | `runId`, `threadId`, `outcome: "interrupt"`, `interrupt: {id, reason, payload}` |
| `RUN_ERROR` | Unrecoverable error | `message`, `code` (optional), `timestamp` |
| `CUSTOM` (WARNING) | Non-fatal warning | `name: "WARNING"`, `value: {message, namespace}` |
| `CUSTOM` (NAMESPACE_CONTEXT) | Before subagent events | `name: "NAMESPACE_CONTEXT"`, `value: {namespace: [...]}` |
| `CUSTOM` (TOOL_ERROR) | ToolMessage starts with "ERROR:" | `name: "TOOL_ERROR"`, `value: {tool_call_id, error}` |

**Events in `SSEEventType` not emitted by current encoder**: `STEP_STARTED`, `STEP_FINISHED`, `STATE_SNAPSHOT`, `STATE_DELTA`, `RAW`. These are reserved for future AG-UI protocol extensions. The Slack bot should handle them gracefully (log and skip).

**Alternatives considered**: Custom SSE protocol — rejected because AG-UI is the standardized protocol and the UI already uses it.

### R2: SSE Client Request Format

**Decision**: Rewrite `stream_chat()` to send `ChatRequest` to `/api/v1/chat/stream/start?protocol=agui`.

**Rationale**: The current `sse_client.py` sends a `RunAgentInput`-style payload (with `threadId`, `runId`, `messages`, `state`, `tools`, `context`, `forwardedProps`) to `/chat/stream`. The dynamic agents backend expects a `ChatRequest` body (`message`, `conversation_id`, `agent_id`, optional `trace_id`) at `/api/v1/chat/stream/start`. The current format is wrong for the target endpoint.

**Request format** (from `dynamic_agents/models.py` and `dynamic_agents/routes/chat.py`):
```json
{
  "message": "user's question text",
  "conversation_id": "uuid-v5-from-thread-ts",
  "agent_id": "agent-config-id-from-channel",
  "trace_id": "optional-langfuse-trace-id"
}
```

**Authentication**: `Authorization: Bearer <jwt>` from existing `OAuth2ClientCredentials` client. When `AUTH_ENABLED=false` on dynamic agents, no token needed.

**Alternatives considered**: Adapting the `RunAgentInput` format to work with dynamic agents — rejected because the backend does not accept it; `ChatRequest` is the defined contract.

### R3: HITL Interrupt and Resume Format

**Decision**: Parse `RUN_FINISHED` events with `outcome: "interrupt"` and resume via `POST /api/v1/chat/stream/resume`.

**Rationale**: AG-UI uses `RUN_FINISHED` with a special `outcome` field to signal HITL interrupts, unlike A2A which used `caipe_form` artifacts. The interrupt payload contains structured field definitions compatible with the existing `HITLForm` dataclass.

**Interrupt payload structure** (from `agui_sse.py:on_input_required`):
```json
{
  "id": "interrupt-uuid",
  "reason": "human_input",
  "payload": {
    "prompt": "Please confirm you want to proceed",
    "fields": [
      {
        "field_name": "approval",
        "field_label": "Do you approve?",
        "field_type": "boolean",
        "required": true
      }
    ],
    "agent": "platform-engineer"
  }
}
```

**Field type mapping** (AG-UI `InputFieldType` → Slack Block Kit):

| AG-UI Type | Slack Block Kit Element |
|---|---|
| `text` | `plain_text_input` |
| `select` | `static_select` with `field_values` as options |
| `multiselect` | `multi_static_select` with `field_values` as options |
| `boolean` | Button pair (Yes/No) or `static_select` with Yes/No |
| `number` | `plain_text_input` with numeric placeholder |
| `url` | `plain_text_input` with URL placeholder |
| `email` | `plain_text_input` with email placeholder |

**Resume request** (from `chat.py:ResumeStreamRequest`):
```json
{
  "agent_id": "agent-config-id",
  "conversation_id": "uuid-v5",
  "form_data": "{\"approval\": true}",
  "trace_id": "optional"
}
```

Note: `form_data` is a JSON **string**, not a parsed object. For rejections: `"User dismissed the input form without providing values."`

**Alternatives considered**: Custom interrupt format — rejected because AG-UI's format is already implemented in the encoder and matches what the web UI consumes.

### R4: Conversation ID Strategy

**Decision**: Deterministic UUID v5 from `thread_ts` using a fixed namespace.

**Rationale**: Eliminates the supervisor lookup API call (`GET /api/v1/conversations/lookup`). Same `thread_ts` always produces the same conversation ID, ensuring follow-up messages in the same thread reuse the same LangGraph checkpoint. No race conditions, no network dependency for ID resolution.

**Implementation** (from research doc):
```python
import uuid

SLACK_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "slack.caipe.io")

def thread_ts_to_conversation_id(thread_ts: str) -> str:
    return str(uuid.uuid5(SLACK_NAMESPACE, thread_ts))
```

**Alternatives considered**: 
- Keep supervisor lookup API — rejected because the supervisor is deprecated
- Random UUID per thread (stored in cache) — rejected because it requires persistence and doesn't survive bot restarts
- Use `thread_ts` directly as conversation ID — rejected because LangGraph expects UUID format

### R5: httpx for SSE Streaming

**Decision**: Use `httpx` with `stream=True` for SSE streaming, replacing the current `requests`-based implementation.

**Rationale**: The user specified httpx. httpx provides async-compatible streaming, better timeout handling, and is already a dependency of the Slack bot (via `pyproject.toml` — it's used by FastMCP and other components). The current `requests.post(stream=True)` approach works but httpx's `client.stream()` context manager provides cleaner resource management.

**SSE parsing approach**: Line-by-line iteration over the response stream, parsing `event:` and `data:` lines. This is the same approach as the current implementation — no SSE library dependency needed.

**Alternatives considered**: `aiohttp` — rejected because the Slack bot runs synchronously (Slack Bolt is sync); `sseclient-py` — rejected as unnecessary dependency for simple line parsing.

### R6: Per-Channel Agent Routing

**Decision**: Add `agent_id: Optional[str]` to `ChannelConfig` with a `default_agent_id` fallback in `GlobalDefaults`.

**Rationale**: Each Slack channel can be configured to route to a different dynamic agent (e.g., `platform-engineer` for ops channels, `code-reviewer` for dev channels). This replaces the single-supervisor model with per-channel specialization.

**Configuration format**:
```yaml
defaults:
  default_agent_id: "platform-engineer"

C12345ABC:
  name: "platform-support"
  agent_id: "platform-engineer"
  ai_enabled: true
```

**Validation**: If `ai_enabled=True` and no `agent_id` is set (and no `default_agent_id`), log a warning and skip the message with an error response.

**Alternatives considered**: Environment variable per channel — rejected because the YAML config already handles per-channel settings; global single `agent_id` — rejected because it defeats the purpose of dynamic agents.

### R7: Web UI Conversation Isolation

**Decision**: Slack conversations are isolated by their deterministic UUID v5 namespace. No additional filtering is needed on the dynamic agents side.

**Rationale**: The web UI generates conversation IDs using `uuid4()` (random). The Slack bot generates them using `uuid5(SLACK_NAMESPACE, thread_ts)`. These UUID spaces are statistically disjoint. The web UI's conversation list endpoint (`GET /api/v1/conversations`) filters by authenticated user, and Slack bot requests use service-level credentials (not user-level), so Slack conversations are naturally excluded from user queries.

**Alternatives considered**: Adding a `source` metadata field to conversations — deferred; the namespace-based approach is sufficient for 0.4.0.

### R8: Existing Broken State on Branch

**Decision**: This migration fixes all three pre-existing issues from the `main` → `release/0.4.0` merge.

| Issue | Root Cause | Fix |
|---|---|---|
| `app.py` calls `stream_sse_response()` but `ai.py` defines `stream_a2a_response()` | Naming mismatch from merge | Phase 2: New function is named `stream_response()`, all callers updated |
| `ai.py` imports `throttler` but `throttler.py` was deleted | Dead import from commit `02525bea` | Phase 2: Import removed; throttler not needed for AG-UI |
| `app.py` passes `SSEClient` but `ai.py` expects `A2AClient` interface | Interface mismatch from partial migration | Phase 2: New `stream_response()` expects `SSEClient` |
