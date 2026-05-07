# SSE Event Contract: Slack Bot ↔ Dynamic Agents

**Date**: 2026-04-14
**Protocol**: AG-UI over SSE
**Direction**: Dynamic Agents (server) → Slack Bot (client)

## Transport

- **Method**: `POST` with `Accept: text/event-stream`
- **Content-Type**: `text/event-stream` (response)
- **Encoding**: UTF-8
- **Frame format**: `event: <TYPE>\ndata: <JSON>\n\n`

## Endpoints

### Start Stream

```
POST /api/v1/chat/stream/start?protocol=agui
Content-Type: application/json
Authorization: Bearer <jwt>  (when AUTH_ENABLED=true)
X-Client-Source: slack-bot

{
  "message": "string",
  "conversation_id": "uuid-string",
  "agent_id": "string",
  "trace_id": "string | null"
}
```

**Response**: SSE stream with events listed below.

**Error responses**:
- `404`: Agent not found (`{"detail": "Agent configuration not found"}`)
- `403`: Access denied (`{"detail": "Access denied to agent"}`)

### Resume Stream (after HITL)

```
POST /api/v1/chat/stream/resume?protocol=agui
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "agent_id": "string",
  "conversation_id": "string",
  "form_data": "json-string-or-rejection-text",
  "trace_id": "string | null"
}
```

**Response**: Same SSE stream format as Start Stream.

### Invoke (Non-Streaming)

```
POST /api/v1/chat/invoke
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "message": "string",
  "conversation_id": "uuid-string",
  "agent_id": "string",
  "trace_id": "string | null"
}
```

**Response** (JSON):
```json
{
  "success": true,
  "content": "agent response text",
  "agent_id": "string",
  "conversation_id": "string",
  "trace_id": "string | null"
}
```

**Error response** (JSON):
```json
{
  "success": false,
  "error": "error description",
  "agent_id": "string",
  "conversation_id": "string",
  "trace_id": "string | null"
}
```

### Health Check

```
GET /healthz
```

**Response**: `200 OK` with health status JSON.

## SSE Event Types

### RUN_STARTED

Emitted once at the beginning of every stream.

```json
{
  "type": "RUN_STARTED",
  "runId": "uuid-string",
  "threadId": "uuid-string",
  "timestamp": 1713100000.0
}
```

### TEXT_MESSAGE_START

Emitted when the first content chunk arrives for a message.

```json
{
  "type": "TEXT_MESSAGE_START",
  "messageId": "msg-uuid",
  "role": "assistant",
  "timestamp": 1713100001.0
}
```

### TEXT_MESSAGE_CONTENT

Emitted for each text token.

```json
{
  "type": "TEXT_MESSAGE_CONTENT",
  "messageId": "msg-uuid",
  "delta": "text chunk",
  "timestamp": 1713100001.1
}
```

### TEXT_MESSAGE_END

Emitted at the end of a text message sequence.

```json
{
  "type": "TEXT_MESSAGE_END",
  "messageId": "msg-uuid",
  "timestamp": 1713100002.0
}
```

### TOOL_CALL_START

Emitted when an AI message contains tool calls.

```json
{
  "type": "TOOL_CALL_START",
  "toolCallId": "call-uuid",
  "toolCallName": "search_jira",
  "timestamp": 1713100003.0
}
```

### TOOL_CALL_ARGS

Emitted immediately after TOOL_CALL_START with truncated arguments.

```json
{
  "type": "TOOL_CALL_ARGS",
  "toolCallId": "call-uuid",
  "delta": "{\"query\": \"OOM issues\"}",
  "timestamp": 1713100003.1
}
```

### TOOL_CALL_END

Emitted when a tool result (ToolMessage) arrives.

```json
{
  "type": "TOOL_CALL_END",
  "toolCallId": "call-uuid",
  "timestamp": 1713100004.0
}
```

### RUN_FINISHED (success)

Emitted when the stream completes successfully.

```json
{
  "type": "RUN_FINISHED",
  "runId": "uuid-string",
  "threadId": "uuid-string",
  "outcome": "success",
  "timestamp": 1713100005.0
}
```

### RUN_FINISHED (interrupt — HITL)

Emitted when the agent requests human input. Mutually exclusive with the success variant.

```json
{
  "type": "RUN_FINISHED",
  "runId": "uuid-string",
  "threadId": "uuid-string",
  "outcome": "interrupt",
  "interrupt": {
    "id": "interrupt-uuid",
    "reason": "human_input",
    "payload": {
      "prompt": "Please confirm the Jira ticket details",
      "fields": [
        {
          "field_name": "summary",
          "field_label": "Ticket Summary",
          "field_type": "text",
          "required": true,
          "default_value": "OOM issue in production"
        },
        {
          "field_name": "priority",
          "field_label": "Priority",
          "field_type": "select",
          "field_values": ["Critical", "High", "Medium", "Low"],
          "required": true
        },
        {
          "field_name": "approval",
          "field_label": "Approve creation?",
          "field_type": "boolean",
          "required": true
        }
      ],
      "agent": "platform-engineer"
    }
  },
  "timestamp": 1713100005.0
}
```

### RUN_ERROR

Emitted on unrecoverable error.

```json
{
  "type": "RUN_ERROR",
  "message": "Agent runtime error: model rate limited",
  "code": "RATE_LIMITED",
  "timestamp": 1713100005.0
}
```

### CUSTOM (WARNING)

Non-fatal warning.

```json
{
  "type": "CUSTOM",
  "name": "WARNING",
  "value": {
    "message": "MCP server argocd is unavailable",
    "namespace": []
  },
  "timestamp": 1713100002.0
}
```

### CUSTOM (NAMESPACE_CONTEXT)

Emitted before subagent events to identify the source agent.

```json
{
  "type": "CUSTOM",
  "name": "NAMESPACE_CONTEXT",
  "value": {
    "namespace": ["jira-agent"]
  },
  "timestamp": 1713100002.0
}
```

### CUSTOM (TOOL_ERROR)

Emitted when a tool returns an error result.

```json
{
  "type": "CUSTOM",
  "name": "TOOL_ERROR",
  "value": {
    "tool_call_id": "call-uuid",
    "error": "Connection refused: argocd server unavailable"
  },
  "timestamp": 1713100004.0
}
```

## Event Ordering

A typical successful stream:

```
RUN_STARTED
[CUSTOM NAMESPACE_CONTEXT]?    # If subagent
TEXT_MESSAGE_START
TEXT_MESSAGE_CONTENT (×N)
TEXT_MESSAGE_END
[TOOL_CALL_START              # If tools used
 TOOL_CALL_ARGS
 TOOL_CALL_END]*
[TEXT_MESSAGE_START            # Response after tool
 TEXT_MESSAGE_CONTENT (×N)
 TEXT_MESSAGE_END]
RUN_FINISHED (outcome=success)
```

A HITL interrupt stream:

```
RUN_STARTED
TEXT_MESSAGE_START
TEXT_MESSAGE_CONTENT (×N)      # Explanation before interrupt
TEXT_MESSAGE_END
RUN_FINISHED (outcome=interrupt)
```

An error stream:

```
RUN_STARTED
[partial events]?
RUN_ERROR
```
