---
sidebar_position: 1
id: 007-streaming-architecture-architecture
sidebar_label: Architecture
---

# Architecture: Platform Engineer Streaming Architecture

**Date**: 2024-10-22

## What Streaming DOES Work

✅ **Platform Engineer's own reasoning** streams token-by-token
- Deep Agent's LLM responses stream via `astream_events`
- Todo list creation streams as it's being generated
- These are captured by `on_chat_model_stream` events

❌ **Sub-agent responses** do NOT stream
- Tool calls block: you see "Calling komodor..." → wait → full response
- Even though sub-agent streams internally, platform engineer doesn't propagate it


## Solutions

### Option 1: Custom Streaming Tool Wrapper (Recommended if staying with LangGraph)

Create a special tool executor that yields chunks during execution:

```python
# In platform_engineer/protocol_bindings/a2a/agent_executor.py

async def execute(self, context: RequestContext, event_queue: EventQueue):
    # Detect if query should go to A2A sub-agent
    sub_agent_name = self._detect_sub_agent_query(query)

    if sub_agent_name:
        # Bypass LangGraph tool system, call A2A directly with streaming
        agent_url = platform_registry.AGENT_ADDRESS_MAPPING[sub_agent_name]
        client = A2AClient(agent_card=await get_agent_card(agent_url))

        # Stream directly to event queue
        async for chunk in client.send_message_streaming(request):
            if isinstance(chunk, A2ATaskArtifactUpdateEvent):
                text = extract_text_from_chunk(chunk)
                await event_queue.enqueue_event(
                    TaskArtifactUpdateEvent(
                        append=True,  # ← Streaming mode
                        artifact=new_text_artifact(text),
                        contextId=task.contextId,
                        taskId=task.id
                    )
                )
        return

    # Otherwise use normal LangGraph flow
    async for event in self.agent.stream(query, context_id):
        yield event
```

**Pros:**
- True streaming from sub-agents
- Works within current architecture
- Can selectively apply to specific sub-agents

**Cons:**
- Bypasses Deep Agent's routing logic
- Need to manually detect which sub-agent to call
- More complex executor logic

### Option 2: Wait for LangGraph Streaming Tools Support

LangGraph is working on native streaming tools support. When available:

```python
class StreamingA2ATool(BaseTool):
    async def _astream(self, prompt: str):
        """Tool that yields chunks instead of returning complete response"""
        async for chunk in self._client.send_message_streaming(request):
            yield extract_text(chunk)  # ← Yields to graph
```

**Pros:**
- Clean, native solution
- Works with Deep Agent's routing

**Cons:**
- Not available yet
- Timeline unknown

### Option 3: Move to Strands + MCP (Alternative Architecture)

Replace Deep Agent with Strands framework which has native streaming support:

```python
# Strands agents stream natively
async for event in strands_agent.stream_async(message):
    if "data" in event:
        yield event["data"]  # ← Streams automatically
```

**Pros:**
- Native streaming support
- Simpler architecture for streaming use cases

**Cons:**
- Major refactoring required
- Different agent framework


## Recommendation: Option 1 (Custom Streaming Executor)

Implement custom streaming handling in the executor for A2A sub-agents while keeping the rest of the Deep Agent architecture intact.

### Implementation Steps

1. **Detect sub-agent queries** in executor
   - Parse query to identify if it's targeting a specific sub-agent
   - Use patterns like "show me komodor clusters" → route to komodor

2. **Bypass tool system for A2A calls**
   - When sub-agent detected, skip Deep Agent's tool invocation
   - Call A2A client directly with streaming

3. **Forward chunks to event queue**
   - Stream A2ATaskArtifactUpdateEvents directly to client
   - Use `append=True` for incremental updates

4. **Fall back to Deep Agent for complex queries**
   - Multi-step workflows still use Deep Agent
   - Only simple "call this agent" queries use direct streaming


## Related

- Spec: [spec.md](./spec.md)
