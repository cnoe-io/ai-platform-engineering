# A2A Common: Intermediate States and Tool Visibility

## Overview

Enhanced the `a2a_common` base classes to provide **detailed visibility** into agent execution, including:

1. **Tool Selection** - See which tools are being called and with what parameters
2. **Tool Execution Status** - Know when tools succeed or fail
3. **Intermediate Progress** - Get real-time updates as agents work

## What Changed

### Before

```
⏳ Agent is working...
⏳ Processing results...
✅ Task completed
```

**Problems**:
- No visibility into which tools are running
- Users don't know if the agent is stuck or making progress
- Debugging is difficult

### After

```
🔧 Calling tool: **list_clusters**
✅ Tool **list_clusters** completed
🔧 Calling tool: **get_cluster_details**
✅ Tool **get_cluster_details** completed
⏳ Processing results...
✅ Task completed
```

**Benefits**:
- ✅ See exactly which tools are being invoked
- ✅ Know when each tool succeeds or fails
- ✅ Better UX with real-time progress updates
- ✅ Easier debugging of agent behavior

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

## Benefits

### 1. Improved User Experience

- **Progress Visibility**: Users see what the agent is doing in real-time
- **Wait Time Justification**: Users understand why operations take time
- **Error Transparency**: Clear indication when specific tools fail

### 2. Better Debugging

- **Tool Call Logging**: All tool invocations are logged
- **Failure Point Identification**: Easy to see which tool failed
- **Argument Inspection**: Tool parameters are visible (truncated for safety)

### 3. Performance Monitoring

- **Tool Execution Tracking**: Monitor which tools are slow
- **Call Frequency**: Identify tools that are called multiple times
- **Failure Rates**: Track tool reliability

### 4. Agent Development

- **Behavior Verification**: Confirm agents are using correct tools
- **Flow Understanding**: See the sequence of tool calls
- **Prompt Tuning**: Identify when agents make wrong tool choices

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

## Testing

### Test Cases

#### 1. Test Tool Call Visibility

```bash
# Query an agent that uses multiple tools
curl -X POST http://localhost:8001 \
  -H "Content-Type: application/json" \
  -d '{"query": "list all clusters in production"}'
```

**Expected**:
- See "🔧 Calling tool: **list_clusters**"
- See "✅ Tool **list_clusters** completed"

#### 2. Test Tool Failure Handling

```bash
# Query that will fail (invalid app name)
curl -X POST http://localhost:8001 \
  -H "Content-Type: application/json" \
  -d '{"query": "show status of nonexistent-app"}'
```

**Expected**:
- See "🔧 Calling tool: **get_application**"
- See "❌ Tool **get_application** failed"

#### 3. Check Logs

```bash
docker logs agent-komodor-p2p 2>&1 | grep "Tool call detected"
```

**Expected**:
```
komodor: Tool call detected - list_clusters
komodor: Tool result received - list_clusters (success)
```

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

## Related Documentation

- [Enhanced Streaming Feature](./2024-10-22-enhanced-streaming-feature.md)
- [Streaming Architecture](./2024-10-22-streaming-architecture.md)

## Conclusion

These enhancements provide **transparency** into agent execution without breaking existing functionality. Users get better feedback, developers get better debugging, and the system becomes more observable.

**Status**: ✅ **READY FOR PRODUCTION**

All agents using `BaseLangGraphAgent` will automatically benefit from these improvements on next restart.

