# Dynamic Agents SSE Event System

This document describes the SSE (Server-Sent Events) streaming protocol between the Dynamic Agents backend and the UI frontend. The system uses structured JSON events to communicate agent activity in real-time.

## Architecture

```
                              BACKEND
  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐
  │  deepagents     │───>│  agent_runtime   │───>│  stream_events    │
  │  library        │    │  .py             │    │  .py              │
  │  (read-only)    │    │                  │    │  Event builders   │
  └─────────────────┘    │  - stream()      │    └───────────────────┘
         │               │  - trackers      │              │
         │               └──────────────────┘              │
         │                        │                        │
         │               ┌──────────────────┐              │
         └──────────────>│  stream_trackers │<─────────────┘
                         │  .py             │
                         │  - ToolTracker   │
                         │  - TodoTracker   │
                         │  - SubagentTracker│
                         └──────────────────┘
                                  │
                                  v SSE Stream
                                  │
                 HTTP POST /api/dynamic-agents/chat/stream
                 Content-Type: text/event-stream
                                  │
                                  v
                              FRONTEND
  ┌─────────────────────┐    ┌──────────────────────┐
  │  dynamic-agent-     │───>│  sse-types.ts        │
  │  client.ts          │    │                      │
  │  - parseSSEStream() │    │  - SSEAgentEvent     │
  │  - mapToAgentEvent()│    │  - createSSEAgentEvent│
  └─────────────────────┘    └──────────────────────┘
           │                          │
           │                          v
           │                 ┌──────────────────────┐
           └────────────────>│  DynamicAgentContext │
                             │  .tsx                │
                             │  - parseTodos()      │
                             │  - parseToolCalls()  │
                             │  - parseSubagentCalls│
                             └──────────────────────┘
                                      │
                                      v
                             ┌──────────────────────┐
                             │  Events Panel UI     │
                             │  - Todos list        │
                             │  - Tool cards        │
                             │  - Subagent cards    │
                             └──────────────────────┘
```

## Event Format

All events are sent as SSE with the format:
```
event: <event_type>
data: <json_payload>

```

## Event Types

| Event Type | Description |
|------------|-------------|
| `content` | LLM token streaming |
| `tool_start` | Tool invocation started |
| `tool_end` | Tool invocation completed |
| `todo_update` | Task list updated |
| `subagent_start` | Subagent invocation started |
| `subagent_end` | Subagent invocation completed |
| `final_result` | Agent response complete |
| `error` | Error occurred |
| `warning` | Non-fatal warning |
| `done` | Stream complete |

---

### `content` - LLM Token Streaming

Streaming text content from the LLM.

```json
{
  "type": "content",
  "data": "Hello, I'll help you..."
}
```

**Backend source:** `stream_events.make_content_event()`

---

### `tool_start` - Tool Invocation Started

Emitted when the agent calls a tool.

```json
{
  "type": "tool_start",
  "data": {
    "tool_name": "search_jira",
    "tool_call_id": "call_abc123",
    "args": {"query": "user tickets..."},
    "agent": "DynamicAgent"
  }
}
```

**Fields:**
| Field | Description |
|-------|-------------|
| `tool_name` | Name of the tool being called |
| `tool_call_id` | Unique ID for this tool invocation (used to match with `tool_end`) |
| `args` | Tool arguments (string values truncated to 100 chars) |
| `agent` | Name of the agent making the call |

**Backend source:** `stream_events.make_tool_start_event()`

---

### `tool_end` - Tool Invocation Completed

Emitted when a tool call completes.

```json
{
  "type": "tool_end",
  "data": {
    "tool_call_id": "call_abc123",
    "agent": "DynamicAgent"
  }
}
```

**Fields:**
| Field | Description |
|-------|-------------|
| `tool_call_id` | Unique ID matching the `tool_start` event |
| `agent` | Name of the agent |

**Note:** The UI matches `tool_end` to `tool_start` using `tool_call_id`.

**Backend source:** `stream_events.make_tool_end_event()`

---

### `todo_update` - Task List Updated

Emitted when the agent calls `write_todos`. Contains the full todo list state.

```json
{
  "type": "todo_update",
  "data": {
    "todos": [
      {"content": "Search for tickets", "status": "completed"},
      {"content": "Analyze results", "status": "in_progress"},
      {"content": "Generate report", "status": "pending"}
    ],
    "agent": "DynamicAgent"
  }
}
```

**Fields:**
| Field | Description |
|-------|-------------|
| `todos[].content` | Description of the task |
| `todos[].status` | One of `"pending"`, `"in_progress"`, `"completed"` |
| `agent` | Name of the agent |

**Backend source:** `stream_events.make_todo_update_event()`

**Note:** Todos are extracted directly from the `write_todos` tool arguments.

---

### `subagent_start` - Subagent Invocation Started

Emitted when the agent calls the `task` tool to delegate work to a subagent.

```json
{
  "type": "subagent_start",
  "data": {
    "tool_call_id": "call_xyz789",
    "subagent_name": "research-agent",
    "purpose": "Find documentation about the API...",
    "parent_agent": "DynamicAgent"
  }
}
```

**Fields:**
| Field | Description |
|-------|-------------|
| `tool_call_id` | Unique ID for this invocation (used to match with `subagent_end`) |
| `subagent_name` | Name of the subagent being invoked |
| `purpose` | Description of what the subagent is doing (truncated to 100 chars) |
| `parent_agent` | Name of the agent that invoked this subagent |

**Backend source:** `stream_events.make_subagent_start_event()`

---

### `subagent_end` - Subagent Invocation Completed

Emitted when a subagent completes its work.

```json
{
  "type": "subagent_end",
  "data": {
    "tool_call_id": "call_xyz789",
    "parent_agent": "DynamicAgent"
  }
}
```

**Fields:**
| Field | Description |
|-------|-------------|
| `tool_call_id` | Unique ID matching the `subagent_start` event |
| `parent_agent` | Name of the agent that invoked this subagent |

**Note:** The UI matches `subagent_end` to `subagent_start` using `tool_call_id`.

**Backend source:** `stream_events.make_subagent_end_event()`

---

### `final_result` - Agent Response Complete

Emitted when the agent produces its final response.

```json
{
  "type": "final_result",
  "data": {
    "artifact": {
      "artifactId": "evt-abc123def456",
      "name": "final_result",
      "description": "Final result from dynamic agent",
      "parts": [{"kind": "text", "text": "Here is my response..."}],
      "metadata": {
        "trace_id": "langfuse-trace-id",
        "agent_name": "DynamicAgent"
      }
    }
  }
}
```

**Backend source:** `stream_events.make_final_result_event()`

---

### `error` - Error Event

Emitted when an error occurs during processing.

```json
{
  "type": "error",
  "data": {
    "error": "Connection timeout"
  }
}
```

---

### `warning` - Warning Event

Emitted for non-fatal warnings during processing.

```json
{
  "type": "warning",
  "data": {
    "message": "Tool execution took longer than expected"
  }
}
```

---

### `done` - Stream Complete

Terminal event indicating the stream has ended.

```
event: done
data: {}
```

---

## File Reference

### Backend Files

| File | Purpose |
|------|---------|
| `src/dynamic_agents/services/stream_events.py` | Event type constants and builder functions |
| `src/dynamic_agents/services/stream_trackers.py` | Stateless event emitter functions |
| `src/dynamic_agents/services/agent_runtime.py` | Main agent runtime, emits SSE events |

### Frontend Files

| File | Purpose |
|------|---------|
| `ui/src/components/dynamic-agents/sse-types.ts` | TypeScript types matching backend events |
| `ui/src/lib/dynamic-agent-client.ts` | SSE stream parser, yields SSEAgentEvent |
| `ui/src/components/dynamic-agents/DynamicAgentContext.tsx` | Events panel UI component |

## UI Rendering

### Events Panel Layout

```
┌─────────────────────────────────────┐
│ Events                        [v]   │
├─────────────────────────────────────┤
│                                     │
│ Tasks                        2/3    │
│ ┌─────────────────────────────────┐ │
│ │ [x] Search for tickets          │ │
│ ├─────────────────────────────────┤ │
│ │ [~] Analyze results             │ │
│ ├─────────────────────────────────┤ │
│ │ [ ] Generate report             │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Running (1)                         │
│ ┌─────────────────────────────────┐ │
│ │ [~] search_jira                 │ │
│ │   query: "user tickets..."      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Completed (2)                  [v]  │
│ ┌─────────────────────────────────┐ │
│ │ [v] list_applications           │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Subagents (1)                  [v]  │
│ ┌─────────────────────────────────┐ │
│ │ [v] research-agent              │ │
│ │   "Find documentation..."       │ │
│ └─────────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

## Implementation Constraints

1. **Cannot modify deepagents library** - The deepagents package is read-only. We must work with its existing `write_todos` and `task` tool implementations.

2. **Todos parsed from ToolMessage** - Since `write_todos` outputs markdown-formatted text, the `TodoTracker` parses this format to extract structured todo data:
   ```
   **Task Progress:**
   
   - [ ] Task description 1
   - [~] Task description 2
   - [x] Task description 3
   ```

3. **Subagents use ainvoke()** - The `task` tool in deepagents uses `ainvoke()` which doesn't emit streaming events. We detect `task` tool calls to track subagent activity.

4. **No breaking changes to A2A** - This event system is specific to Dynamic Agents SSE streaming. A2A agents use a separate event system.

## Testing

After making changes:

1. Start a Dynamic Agent conversation
2. Verify tool events appear in the Events panel with correct status
3. Verify `write_todos` triggers todo_update events with progress bar
4. Verify builtin tools render as compact inline chips
5. Verify MCP tools render as cards with args
6. Verify subagent delegations show with purpose
7. Verify chat content still has full markdown formatting
