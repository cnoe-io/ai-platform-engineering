---
sidebar_position: 1
id: 039-context-management-and-resilience-architecture
sidebar_label: Architecture
---

# Architecture: Context Management and Error Resilience Architecture

**Date**: 2025-12-13

## Solution Architecture

### Layer 1: Pre-flight Context Check (BaseLangGraphAgent)

**Location**: `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py`

**Functionality**:
```python
async def _preflight_context_check(config, query):
    # Estimate tokens: system + history + query + tool schemas
    total_estimated = system_tokens + history_tokens + query_tokens + tool_schema_tokens
    
    # Trigger at 80% of max (leave room for response)
    if total_estimated > (max_context_tokens * 0.8):
        # Use LangMem to summarize old messages
        summary = await summarize_messages(old_messages)
        # Replace old messages with summary SystemMessage
        # ✅ Context preserved, tokens reduced
```

**Benefits**:
- ✅ Proactive prevention (before LLM call)
- ✅ Preserves context via LangMem summarization
- ✅ Configurable threshold (default 80%)
- ✅ Falls back to deletion if LangMem unavailable

### Layer 2: Supervisor Exception Recovery (Platform Engineer)

**Location**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py`

**Functionality**:
```python
except ValueError as ve:
    if "tool_calls that do not have a corresponding ToolMessage" in str(ve):
        # Add synthetic ToolMessages for orphaned calls
        synthetic_msgs = [ToolMessage(content="Tool interrupted", tool_call_id=id)]
        await graph.aupdate_state(config, {"messages": synthetic_msgs})
        # ✅ Conversation recovered, LangGraph happy
    
    elif "Input is too long" in str(ve):
        # Summarize conversation with LangMem
        summary = await summarize_messages(all_messages)
        await graph.aupdate_state(config, {"messages": [SystemMessage(summary)]})
        # ✅ Context preserved, overflow resolved
```

**Benefits**:
- ✅ Graceful recovery from validation errors
- ✅ Supervisor stays responsive
- ✅ Context preserved via summarization
- ✅ Clear error messages to users

### Layer 3: A2A Queue Lifecycle Management (SupervisorExecutor)

**Location**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py`

**Functionality**:
```python
async def _safe_enqueue_event(event_queue, event):
    try:
        await event_queue.enqueue_event(event)
        # Reset closure flag if queue reopens
        if self._queue_closed_logged:
            logger.info("Queue reopened")
            self._queue_closed_logged = False
    except Exception as e:
        if "Queue is closed" in str(e):
            # Log ONCE when first closed
            if not self._queue_closed_logged:
                logger.warning("Event queue closed")
                self._queue_closed_logged = True
            # Then SILENT (no spam)
```

**Benefits**:
- ✅ Eliminates log spam (35+ → 1 message)
- ✅ Detects queue reopening
- ✅ Cleaner logs for debugging

### Layer 4: Tool Call Tracking (Supervisor)

**Location**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py`

**Functionality**:
```python
# Track pending tool calls
pending_tool_calls = {}  # {tool_call_id: tool_name}

# When AIMessage with tool_call:
pending_tool_calls[tool_call_id] = tool_name

# When ToolMessage received:
pending_tool_calls.pop(tool_call_id)  # Mark as resolved

# On error, check for orphans:
if pending_tool_calls:
    # Add synthetic ToolMessages
```

**Benefits**:
- ✅ Ensures every tool call gets ToolMessage
- ✅ Prevents LangGraph validation errors
- ✅ Enables error recovery


## LangMem Integration

### What is LangMem?

[LangMem](https://langchain-ai.github.io/langmem/) is a LangChain library for intelligent conversation memory management. Instead of deleting messages, it:
- Extracts key information
- Summarizes conversations
- Preserves context in compressed form

### Dependencies Added

```toml
# ai_platform_engineering/utils/pyproject.toml
dependencies = [
    "langmem>=0.0.30",
    ...
]

# ai_platform_engineering/multi_agents/pyproject.toml
dependencies = [
    "langmem>=0.0.30",
    ...
]
```

### Usage Pattern

```python
from langmem import summarize_messages

# Instead of: messages = messages[-10:]  # Delete old, lose context
# Do this:
summary = await summarize_messages(old_messages)
messages = [SystemMessage(summary)] + recent_messages  # Preserve context
```


## Configuration

### Environment Variables

```bash
# Tool output truncation (safety net)
MAX_TOOL_OUTPUT_SIZE=10000  # Default: 10KB (safe for smaller models)
MAX_TOOL_OUTPUT_SIZE=50000  # For larger context models

# Context management
# (Uses provider-specific limits from context_config.py)
# AWS Bedrock Claude: 100K tokens
# OpenAI GPT-4: 128K tokens
# Azure OpenAI: Configurable
```

### Auto-Configuration

The system automatically:
- Detects LLM provider from `LLM_PROVIDER` env var
- Sets appropriate context limits via `get_context_limit_for_provider()`
- Triggers pre-flight check at 80% of limit
- Summarizes to 50% of limit when triggered


## Migration Path

### For Existing Deployments

1. **Update dependencies**: `uv sync` in utils and multi_agents directories
2. **No configuration changes required** - works with existing settings
3. **Gradual rollout**: LangMem gracefully falls back if import fails

### For New Agents

All new agents using `BaseLangGraphAgent` automatically get:
- ✅ Pre-flight context checking
- ✅ LangMem summarization
- ✅ Tool output truncation
- ✅ Error handling


## Performance Impact

### Overhead

- **Pre-flight check**: ~10ms (token counting only when approaching limit)
- **LangMem summarization**: ~2-5s (calls LLM once to summarize)
- **Tool output truncation**: &lt;1ms (string operations)
- **Queue tracking**: &lt;1ms (boolean flag check)

### Benefits

- **Prevents crashes**: No more "Input is too long" errors
- **Preserves context**: Users don't lose conversation history
- **Reduces retries**: Fewer failed requests = better UX
- **Cleaner logs**: 97% reduction in "Queue is closed" spam


## Alternatives Considered

### 1. Simple Message Deletion (Current Before This Change)
- ❌ Loses context
- ❌ Reactive (after error)
- ✅ Fast
- **Decision**: Keep as fallback when LangMem unavailable

### 2. Fixed-Size Sliding Window
- ❌ Loses context
- ❌ Doesn't adapt to message sizes
- ✅ Predictable
- **Decision**: Rejected, LangMem is better

### 3. Increase Context Limits
- ❌ Not all models support larger contexts
- ❌ Higher costs
- ❌ Slower responses
- **Decision**: Rejected, manage efficiently instead


## Future Enhancements

### Short-term (Next Sprint)

1. **Background Memory Manager**: Use LangMem's background processing to continuously extract key facts
2. **User Profiles**: Store user preferences and context across sessions
3. **Semantic Search**: Query conversation summaries for relevant past context

### Long-term (Q1 2026)

1. **Multi-session Memory**: Persist summaries in LangGraph Store
2. **Smart Summarization Triggers**: Summarize based on topic shifts, not just token count
3. **Memory Tools**: Let agents explicitly manage their own memories


## Author

Sri Aradhyula &lt;sraradhy@cisco.com&gt;


## Reviewers

- TBD


## Approval

- [ ] Code reviewed
- [ ] Tested in development
- [ ] Tested in staging
- [ ] Ready for production







## Related

- Spec: [spec.md](./spec.md)
