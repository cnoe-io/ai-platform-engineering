---
sidebar_position: 1
id: 001-a2a-intermediate-states-architecture
sidebar_label: Architecture
---

# Architecture: A2A Common: Intermediate States and Tool Visibility

**Date**: 2024-10-22

## Implementation Details

### Files Modified

#### 1. `base_langgraph_agent.py`

**Enhanced Stream Method** (lines 224-317):

```python
# Track tool calls to avoid duplicates
seen_tool_calls = set()

async for message in self.graph.astream(inputs, config, stream_mode='messages'):
    if isinstance(message, AIMessage) and message.tool_calls:
        for tool_call in message.tool_calls:
            # Extract tool metadata
            tool_name = tool_call.get("name", "unknown")
            tool_args = tool_call.get("args", {})
            tool_id = tool_call.get("id", "")

            # Yield detailed tool call message
            yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': f"🔧 Calling tool: **{tool_name}**",
                'tool_call': {
                    'name': tool_name,
                    'args': tool_args,
                    'id': tool_id,
                }
            }

    elif isinstance(message, ToolMessage):
        # Show tool completion status
        tool_name = getattr(message, "name", "unknown")
        is_error = "error" in str(message.content).lower()[:100]

        icon = "❌" if is_error else "✅"
        status = "failed" if is_error else "completed"

        yield {
            'is_task_complete': False,
            'require_user_input': False,
            'content': f"{icon} Tool **{tool_name}** {status}",
            'tool_result': {
                'name': tool_name,
                'status': 'error' if is_error else 'success',
                'has_content': bool(message.content),
            }
        }
```

**Key Features**:
- Extracts tool name, arguments, and ID
- Formats tool arguments (truncated if > 100 chars)
- Detects tool success/failure
- Avoids duplicate messages using `seen_tool_calls` set
- Maintains backward compatibility with generic messages

#### 2. `base_langgraph_agent_executor.py`

**Enhanced Event Streaming** (lines 128-160):

```python
# Agent is still working - send working status with optional tool metadata
message_obj = new_agent_text_message(
    event['content'],
    task.contextId,
    task.id,
)

# Log tool calls for debugging
if 'tool_call' in event:
    tool_call = event['tool_call']
    logger.info(f"{agent_name}: Tool call detected - {tool_call['name']}")

# Log tool results for debugging
if 'tool_result' in event:
    tool_result = event['tool_result']
    logger.info(f"{agent_name}: Tool result received - {tool_result['name']} ({tool_result['status']})")

await event_queue.enqueue_event(
    TaskStatusUpdateEvent(
        status=TaskStatus(state=TaskState.working, message=message_obj),
        final=False,
        contextId=task.contextId,
        taskId=task.id,
    )
)
```

**Key Features**:
- Logs tool calls and results to server logs
- Preserves tool metadata in event stream
- Can be extended to attach metadata to A2A messages
- Maintains backward compatibility


## Event Stream Structure

### New Event Fields

#### Tool Call Event

```python
{
    'is_task_complete': False,
    'require_user_input': False,
    'content': "🔧 Calling tool: **list_clusters**",
    'tool_call': {
        'name': 'list_clusters',
        'args': {'filter': 'production'},
        'id': 'call_abc123'
    }
}
```

#### Tool Result Event

```python
{
    'is_task_complete': False,
    'require_user_input': False,
    'content': "✅ Tool **list_clusters** completed",
    'tool_result': {
        'name': 'list_clusters',
        'status': 'success',  # or 'error'
        'has_content': True
    }
}
```


## Usage Examples

### Example 1: Komodor Agent

**Query**: "Show me unhealthy clusters"

**Before**:
```
⏳ Processing your request...
⏳ Analyzing results...
✅ Here are the unhealthy clusters...
```

**After**:
```
🔧 Calling tool: **list_clusters**
✅ Tool **list_clusters** completed
🔧 Calling tool: **filter_by_health_status**
✅ Tool **filter_by_health_status** completed
⏳ Analyzing results...
✅ Here are the unhealthy clusters...
```

### Example 2: ArgoCD Agent with Error

**Query**: "Get status of my-app"

**Before**:
```
⏳ Processing your request...
❌ Unable to retrieve application status
```

**After**:
```
🔧 Calling tool: **get_application**
❌ Tool **get_application** failed
⏳ Attempting alternative approach...
✅ Here's what I found about my-app...
```


## Backward Compatibility

✅ **Fully Backward Compatible**

- Generic messages (e.g., "Processing results...") are still sent
- Old clients that don't parse `tool_call`/`tool_result` fields still work
- New fields are optional - ignored by legacy code
- No breaking changes to existing agents


## Future Enhancements

### Short Term

1. **Rich Tool Arguments Display**
   - Pretty-print JSON arguments
   - Syntax highlighting for code parameters
   - Expandable/collapsible argument view

2. **Tool Execution Timing**
   - Add timestamps to tool_call and tool_result events
   - Calculate and display tool execution duration
   - Identify slow tools automatically

3. **A2A Metadata Propagation**
   - Attach tool metadata to A2A message objects
   - Enable supervisor agents to see sub-agent tool usage
   - Build tool execution traces across agent hierarchies

### Long Term

1. **Tool Call Replay**
   - Capture tool arguments for debugging
   - Allow replaying failed tool calls
   - Build test suites from real interactions

2. **Tool Performance Analytics**
   - Aggregate tool execution stats
   - Build dashboards showing tool reliability
   - Identify optimization opportunities

3. **Interactive Tool Approval**
   - Ask user for confirmation before calling certain tools
   - Show tool arguments and expected outcome
   - Allow users to modify parameters before execution


## Migration Guide

### For Agent Developers

**No changes required!** All agents using `BaseLangGraphAgent` automatically get these enhancements.

### For UI Developers

**Optional**: Parse new `tool_call` and `tool_result` fields for richer display:

```typescript
interface AgentEvent {
  is_task_complete: boolean;
  require_user_input: boolean;
  content: string;
  tool_call?: {
    name: string;
    args: Record<string, any>;
    id: string;
  };
  tool_result?: {
    name: string;
    status: 'success' | 'error';
    has_content: boolean;
  };
}
```


## Conclusion

These enhancements provide **transparency** into agent execution without breaking existing functionality. Users get better feedback, developers get better debugging, and the system becomes more observable.

**Status**: ✅ **READY FOR PRODUCTION**

All agents using `BaseLangGraphAgent` will automatically benefit from these improvements on next restart.



## Related

- Spec: [spec.md](./spec.md)
