# Data Model: Slack Bot AG-UI Migration

**Date**: 2026-04-14
**Spec**: [spec.md](./spec.md)

## Entities

### SSEEvent (Updated)

Represents a parsed AG-UI Server-Sent Event from the dynamic agents backend.

| Field | Type | Description |
|---|---|---|
| `type` | `SSEEventType` (enum) | Event type (RUN_STARTED, TEXT_MESSAGE_CONTENT, etc.) |
| `delta` | `str | None` | Text content delta (TEXT_MESSAGE_CONTENT, TOOL_CALL_ARGS) |
| `message_id` | `str | None` | Message identifier (TEXT_MESSAGE_START/CONTENT/END) |
| `tool_call_id` | `str | None` | Tool call identifier (TOOL_CALL_START/ARGS/END) |
| `tool_call_name` | `str | None` | Tool function name (TOOL_CALL_START) |
| `run_id` | `str | None` | Run identifier (RUN_STARTED/FINISHED/ERROR) |
| `thread_id` | `str | None` | Thread/conversation identifier (RUN_STARTED/FINISHED) |
| `outcome` | `str | None` | Run outcome: "success" or "interrupt" (RUN_FINISHED only) |
| `interrupt` | `dict | None` | HITL interrupt payload (RUN_FINISHED with outcome=interrupt) |
| `message` | `str | None` | Error message (RUN_ERROR) |
| `name` | `str | None` | Custom event name (CUSTOM) |
| `value` | `Any | None` | Custom event value (CUSTOM) |
| `steps` | `list | None` | JSON Patch operations (STATE_DELTA) |
| `snapshot` | `dict | None` | Full state snapshot (STATE_SNAPSHOT) |

**State transitions**: None (SSEEvent is a value object, not stateful).

### ChatRequest (Slack Bot Side)

Request payload sent from the Slack bot to the dynamic agents backend.

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | `str` | Yes | User's message text |
| `conversation_id` | `str` | Yes | UUID v5 derived from Slack thread_ts |
| `agent_id` | `str` | Yes | Dynamic agent config ID from channel config |
| `trace_id` | `str | None` | No | Langfuse trace ID (optional) |

### ResumeRequest

Request payload for resuming after HITL interrupt.

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_id` | `str` | Yes | Same agent_id as the interrupted stream |
| `conversation_id` | `str` | Yes | Same conversation_id as the interrupted stream |
| `form_data` | `str` | Yes | JSON string of form field values, or rejection message |
| `trace_id` | `str | None` | No | Langfuse trace ID (optional) |

### ChannelConfig (Updated)

Configuration for a Slack channel's bot behavior.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | `str` | Yes | — | Human-readable channel name |
| `ai_enabled` | `bool` | No | `True` | Whether the bot responds in this channel |
| `agent_id` | `str | None` | No | `None` (falls back to `defaults.default_agent_id`) | Dynamic agent config ID for this channel |
| `custom_prompt` | `str | None` | No | `None` | Override prompt for @mentions |
| `qanda` | `QandaConfig` | No | Default | Q&A mode configuration |
| `ai_alerts` | `AIAlertsConfig` | No | Default | AI alert processing configuration |
| `other` | `OtherConfig` | No | Default | Jira, escalation, delete admin config |

**New in this migration**: `agent_id` field.

### GlobalDefaults (Updated)

| Field | Type | Default | Description |
|---|---|---|---|
| `default_agent_id` | `str | None` | `None` | Fallback agent_id when channel has none configured |
| *(all existing fields)* | — | — | response_style_instruction, prompts, etc. |

**New in this migration**: `default_agent_id` field.

### HITLInterrupt

Parsed HITL interrupt from AG-UI `RUN_FINISHED` event.

| Field | Type | Description |
|---|---|---|
| `interrupt_id` | `str` | Unique identifier for this interrupt (from `interrupt.id`) |
| `reason` | `str` | Always `"human_input"` |
| `prompt` | `str` | Human-readable description of what input is needed |
| `fields` | `list[InterruptField]` | Form field definitions |
| `agent` | `str` | Name of the agent requesting input |

### InterruptField

A single form field in a HITL interrupt.

| Field | Type | Description |
|---|---|---|
| `field_name` | `str` | Machine-readable field identifier |
| `field_label` | `str` | Human-readable label |
| `field_description` | `str | None` | Optional help text |
| `field_type` | `str` | One of: text, select, multiselect, boolean, number, url, email |
| `field_values` | `list[str] | None` | Options for select/multiselect fields |
| `required` | `bool` | Whether the field is required |
| `default_value` | `str | None` | Default value |
| `placeholder` | `str | None` | Placeholder text |

### ConversationId (Value Object)

| Property | Value |
|---|---|
| Format | UUID v5 |
| Namespace | `uuid5(NAMESPACE_URL, "slack.caipe.io")` — constant |
| Name | Slack `thread_ts` string |
| Determinism | Same `thread_ts` always produces the same UUID |

### SessionManager Caches (Simplified)

| Cache | Key | Value | TTL |
|---|---|---|---|
| `_user_info_cache` | `user_id` | Slack user info dict | 600s |
| `_skipped_cache` | `thread_ts` | Skip reason string | 300s |
| `_escalated_threads` | `thread_ts` | Boolean (set membership) | No TTL |

**Removed caches**: `_context_cache` (conversation IDs are now computed, not cached), `_trace_cache` (trace_id is `conversation_id` in AG-UI).

## Relationships

```text
ChannelConfig ──has── agent_id ──resolves to── DynamicAgentConfig (backend)
SlackThread ──generates── ConversationId (UUID v5 from thread_ts)
ConversationId ──maps to── LangGraph thread_id (backend)
SSEClient ──sends── ChatRequest ──to── /api/v1/chat/stream/start
SSEClient ──receives── SSEEvent stream
SSEEvent(RUN_FINISHED, interrupt) ──parsed as── HITLInterrupt
HITLInterrupt ──rendered as── Slack Block Kit form
FormSubmission ──sends── ResumeRequest ──to── /api/v1/chat/stream/resume
```
