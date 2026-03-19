# Dynamic Agents SSE Events

Real-time streaming from Dynamic Agents backend to UI.

## Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                        │
│                                                                             │
│  ┌──────────────┐     ┌─────────────────────────────────────────────────┐  │
│  │  LangGraph   │     │              agent_runtime.py                   │  │
│  │  astream()   │────>│  stream() / resume()                            │  │
│  │              │     │    │                                            │  │
│  │  yields:     │     │    ├─> transform_stream_chunk()  ─┐             │  │
│  │  (ns,mode,   │     │    │   (from stream_events.py)    │             │  │
│  │   data)      │     │    │                              v             │  │
│  └──────────────┘     │    │                    ┌───────────────────┐   │  │
│                       │    │                    │ stream_events.py  │   │  │
│                       │    │                    │                   │   │  │
│                       │    │                    │ make_content()    │   │  │
│                       │    │                    │ make_tool_start() │   │  │
│                       │    │                    │ make_tool_end()   │   │  │
│                       │    │                    │ make_todo_update()│   │  │
│                       │    │                    │ make_subagent_*() │   │  │
│                       │    │                    │ make_final_result │   │  │
│                       │    │<───────────────────│ make_input_req()  │   │  │
│                       │    │                    └───────────────────┘   │  │
│                       │    v                                            │  │
│                       │  yield event ──> [optional event_adapter] ──>   │  │
│                       └─────────────────────────────────────────────────┘  │
│                                          │                                  │
└──────────────────────────────────────────│──────────────────────────────────┘
                                           │
                          POST /api/dynamic-agents/chat/stream
                          Content-Type: text/event-stream
                                           │
                                           v
┌──────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
│                                                                              │
│  ┌──────────────────────┐     ┌──────────────────┐     ┌─────────────────┐  │
│  │ dynamic-agent-       │────>│ sse-types.ts     │────>│ DynamicAgent    │  │
│  │ client.ts            │     │                  │     │ Context.tsx     │  │
│  │                      │     │ SSEAgentEvent    │     │                 │  │
│  │ parseSSEStream()     │     │ type guards      │     │ Events Panel    │  │
│  └──────────────────────┘     └──────────────────┘     └─────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Event Types

| Event | Trigger | Purpose |
|-------|---------|---------|
| `content` | AIMessage chunk | LLM token streaming |
| `tool_start` | AIMessage.tool_calls | Tool invocation started |
| `tool_end` | ToolMessage received | Tool completed |
| `todo_update` | write_todos tool called | Task list update (from args) |
| `subagent_start` | task tool called | Subagent delegation started |
| `subagent_end` | task ToolMessage received | Subagent completed |
| `final_result` | Stream ends | Full response + metadata |
| `input_required` | request_user_input called | HITL form needed |
| `error` | Exception | Error message |
| `done` | Stream ends | Terminal event |

## Files

| File | Responsibility |
|------|----------------|
| `stream_events.py` | Event constants, builders (`make_*`), LangGraph→SSE transform |
| `agent_runtime.py` | Orchestration, calls `transform_stream_chunk()`, yields events |
| `routes/chat.py` | HTTP endpoint, wraps events as SSE format |

## Adding a New Event

1. Add constant in `stream_events.py`:
   ```python
   MY_EVENT = "my_event"
   ```

2. Add builder function:
   ```python
   def make_my_event(data: str, agent: str) -> dict[str, Any]:
       logger.debug(f"[sse:{MY_EVENT}] {data}")
       return {"type": MY_EVENT, "data": {"value": data, "agent": agent}}
   ```

3. Add detection in `_handle_updates_chunk()` or `_handle_messages_chunk()`

4. Add TypeScript type in `ui/src/components/dynamic-agents/sse-types.ts`

## Caveats

1. **deepagents is read-only** — Cannot modify the `write_todos` or `task` tool implementations. Must work with existing behavior.

2. **Todos from args, not output** — The `write_todos` tool outputs markdown, but we extract todos from the tool's `args` (structured data) not its output. This happens in `make_todo_update_from_tool_call()`.

3. **Subagents don't stream** — The `task` tool uses `ainvoke()` internally, so subagent work is opaque. We only see start/end events.

4. **Namespace filtering** — `transform_stream_chunk()` ignores chunks with non-empty namespace (subgraph internals). Only parent agent events become SSE events.

5. **ToolMessage content hidden** — Tool results (e.g., RAG JSON) are NOT sent as `content` events. Only AIMessage content reaches the chat.

## Debugging

Enable debug logging to see event emission:

```python
import logging
logging.getLogger("dynamic_agents.services.stream_events").setLevel(logging.DEBUG)
```

Events log as: `[sse:tool_start] search_jira id=abc123...`

## Event Format

```
event: <event_type>
data: <json>

```

Example `tool_start`:
```json
{"type": "tool_start", "data": {"tool_name": "search_jira", "tool_call_id": "call_abc", "args": {"query": "..."}, "agent": "DynamicAgent"}}
```
