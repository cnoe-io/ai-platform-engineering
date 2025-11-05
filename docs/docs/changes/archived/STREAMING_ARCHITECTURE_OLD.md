# Platform Engineer Streaming Architecture

## Overview

The Platform Engineer uses **Deep Agent's native subagent streaming** to enable token-by-token streaming from sub-agents (like `agent-komodor-p2p`, `agent-github-p2p`, etc.) all the way to the end client.

## How It Works

### 1. Sub-Agent Configuration

A2A agents use a **hybrid architecture** - tools passed to BOTH supervisor and subagents:

```python
# In deep_agent.py
base_model = LLMFactory().get_llm()
all_agents = platform_registry.get_all_agents()  # A2ARemoteAgentConnectTools

# Generate CustomSubAgents (pre-created react agents with A2A tools)
subagents = platform_registry.generate_subagents(agent_prompts, base_model)

deep_agent = async_create_deep_agent(
    tools=all_agents,  # A2A tools for visibility and streaming events
    subagents=subagents,  # CustomSubAgents for proper task() delegation
    instructions=system_prompt,
    model=base_model
)

# Why Hybrid?
# - Supervisor has tools → tool_call/tool_result events stream properly
# - Subagents provide task() interface → write_todos workflow works
# - System prompt encourages task() delegation → avoids conflicts
```

### 2. Deep Agent Streaming Flow

```
Client Request
    ↓
Platform Engineer (Deep Agent)
    ↓ (recognizes query needs sub-agent)
Invokes Sub-Agent (e.g., Komodor)
    ↓ (streams response)
Deep Agent propagates stream
    ↓ (via astream_events)
Platform Engineer A2A Binding
    ↓ (A2A JSON-RPC streaming protocol)
Client receives token-by-token
```

### 3. Event Stream Processing

The platform engineer's A2A binding listens for stream events:

```python
async for event in self.graph.astream_events(inputs, config, version="v2"):
    if event_type == "on_chat_model_stream":
        # This captures:
        # - Platform engineer's own reasoning
        # - Sub-agent streaming responses (via Deep Agent)
        yield {"content": chunk.content}
```

## Why Subagents Instead of Tools?

| Aspect | Tools | Subagents |
|--------|-------|-----------|
| **Streaming** | ❌ Blocking (waits for complete response) | ✅ Token-by-token streaming |
| **Invocation** | Tool call → waits → returns full response | Invokes → streams → continues |
| **User Experience** | Sees "Calling komodor..." then full response | Sees tokens as they're generated |
| **LLM Behavior** | LLM treats as external function call | LLM delegates to specialist agent |

## Previous Issue

Before this fix, agents were configured as **BOTH** tools and subagents:

```python
# OLD (PROBLEMATIC):
deep_agent = async_create_deep_agent(
    tools=all_agents,  # ← Agents as blocking tools
    subagents=subagents,  # ← Agents as streaming subagents
    ...
)
```

**Problem**: When both were available, the LLM would choose the tool interface (blocking) more frequently than the subagent interface (streaming).

## Implementation Details

### Sub-Agent Requirements

For streaming to work, sub-agents must:

1. **Implement A2A streaming protocol** (`send_message_streaming`)
2. **Yield chunks** via `TaskArtifactUpdateEvent`
3. **Handle A2A JSON-RPC** streaming messages

### Platform Engineer Executor

The executor (`platform_engineer/protocol_bindings/a2a/agent_executor.py`) handles:

- Receiving streaming events from Deep Agent
- Converting to A2A events
- Enqueuing to the event queue for the client

```python
async for event in self.agent.stream(query, context_id, trace_id):
    if isinstance(event, A2ATaskArtifactUpdateEvent):
        await event_queue.enqueue_event(event)
```

## Testing Streaming

### 1. Using agent-chat-cli

```bash
uvx git+https://github.com/cnoe-io/agent-chat-cli a2a \
  --host 10.99.255.178 \
  --port 8000

# Then type:
# > show me komodor clusters
#
# You should see tokens streaming in real-time
```

### 2. Monitor Logs

```bash
docker logs platform-engineer-p2p -f | grep -E "(stream|chunk|subagent)"
```

Look for:
- `🤖 Subagents (streaming): [...]` - confirms subagent mode
- `on_chat_model_stream` events - confirms streaming
- No `on_tool_start` for sub-agents - confirms not using tool interface

### 3. Check Deep Agent Behavior

```bash
# Enable debug logging
export LOG_LEVEL=DEBUG

# Watch for subagent invocations
docker logs platform-engineer-p2p -f | grep -i "subagent"
```

## Troubleshooting

### Issue: Not streaming, seeing full response at once

**Cause**: Deep Agent might be using tools instead of subagents

**Fix**: Verify `tools=[]` in `deep_agent.py` line 119

### Issue: "Agent not found" errors

**Cause**: Sub-agent not registered or not running

**Fix**:
```bash
# Check agent registry
docker logs platform-engineer-p2p | grep "Subagents"

# Verify sub-agent is running
docker ps | grep komodor
curl http://agent-komodor-p2p:8000/.well-known/agent.json
```

### Issue: Partial streaming (starts then stops)

**Cause**: Sub-agent's streaming implementation incomplete

**Fix**: Check sub-agent's `stream()` method yields all chunks

## Performance Considerations

- **Latency**: First token arrives faster with streaming (TTFT improvement)
- **Throughput**: Overall completion time similar to blocking
- **UX**: Much better perceived performance
- **Network**: More frequent small messages vs one large message

## Future Enhancements

1. **Parallel Sub-Agent Streaming**: Stream from multiple sub-agents simultaneously
2. **Streaming Aggregation**: Combine streams from multiple sources
3. **Backpressure Handling**: Rate limiting for slow clients
4. **Streaming Telemetry**: Track streaming metrics (tokens/sec, latency)

## References

- Deep Agent Documentation: https://docs.deepagent.ai/
- A2A Protocol Spec: https://github.com/cnoe-io/a2a-spec
- LangGraph Streaming: https://python.langchain.com/docs/langgraph/streaming

