# Platform Engineer Streaming Architecture

**Status**: 🔴 Abandoned (Superseded by 2024-10-23-platform-engineer-streaming-architecture.md)
**Category**: Architecture & Core Design
**Date**: October 22, 2024

## Current Status: ⚠️ **Streaming Not Fully Working** (Historical Note)

Token-by-token streaming from sub-agents (like `agent-komodor-p2p`) to clients is currently **NOT working** due to LangGraph's tool execution model. This document explains why and outlines the solution path.

## The Problem

### Current Architecture

```
Client Request
    ↓
Platform Engineer (Deep Agent + LangGraph)
    ↓
A2ARemoteAgentConnectTool (blocks here!)
    ↓ (internally streams from sub-agent)
Sub-Agent streams response → Tool accumulates → Returns complete text
    ↓
Platform Engineer receives complete response as one chunk
    ↓
Client receives full response at once (no streaming)
```

### Root Cause

**LangGraph tools are blocking by design.** When Deep Agent invokes a tool:

1. Tool execution blocks the graph
2. `A2ARemoteAgentConnectTool._arun()` is called
3. Inside `_arun()`, the tool DOES stream from the sub-agent via A2A protocol
4. **BUT** it accumulates all chunks into `accumulated_text`
5. Only returns the complete response when streaming finishes
6. LangGraph receives this as a single `ToolMessage`

**Code Evidence** (`ai_platform_engineering/utils/a2a_common/a2a_remote_agent_connect.py:198-226`):

```python
accumulated_text: list[str] = []

async for chunk in self._client.send_message_streaming(streaming_request):
    # Chunks ARE received from sub-agent
    writer({"type": "a2a_event", "data": chunk_dump})  # ← This writes somewhere but doesn't propagate

    if isinstance(chunk, A2ATaskArtifactUpdateEvent):
        text = extract_text(chunk)
        accumulated_text.append(text)  # ← Accumulating, not yielding!

# Return complete response after ALL chunks received
final_response = " ".join(accumulated_text).strip()
return Output(response=final_response)  # ← Blocking return
```

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

## Testing Streaming

### Current State (Not Streaming)

```bash
uvx --no-cache git+https://github.com/cnoe-io/agent-chat-cli.git a2a \
  --host 10.99.255.178 --port 8000

# Type: show me komodor clusters
#
# Behavior: Shows "Calling komodor..." → wait → complete response appears
```

### After Fix (Streaming)

```bash
# Same command
#
# Expected: Tokens appear one by one as they're generated by komodor agent
```

## References

- LangGraph Streaming: https://python.langchain.com/docs/langgraph/streaming
- A2A Protocol: https://github.com/cnoe-io/a2a-spec
- Deep Agent: https://docs.deepagent.ai/
- Related Issue: https://github.com/langchain-ai/langgraph/issues/XXXX (streaming tools)
