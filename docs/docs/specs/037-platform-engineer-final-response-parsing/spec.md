---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-08: ADR: Platform Engineer Final Response Parsing and DataPart Implementation"
---

# ADR: Platform Engineer Final Response Parsing and DataPart Implementation

**Status**: 🟢 In-use
**Category**: Bug Fixes & Performance
**Date**: November 8, 2025
**Signed-off-by**: Sri Aradhyula \<sraradhy@cisco.com\>

## Overview

Fixed a critical bug where the Platform Engineer's final `AIMessage` was not being parsed to extract `is_task_complete` from the LLM's structured response. This caused the agent to always send `partial_result` artifacts with plain text instead of `final_result` artifacts with structured JSON data (DataPart).

Additionally implemented proper A2A `DataPart` support for structured responses, controlled by the `ENABLE_STRUCTURED_OUTPUT` feature flag, allowing the Platform Engineer to send structured JSON data to clients that understand it.


## Motivation

### Symptoms

1. **Wrong Artifact Type**: Platform Engineer always sent `partial_result` instead of `final_result`
2. **Plain Text JSON**: Structured JSON response was appended as plain text instead of being sent as `DataPart`
3. **Incomplete Task State**: The `is_task_complete: true` field from LLM's response was ignored

### Example of Incorrect Behavior

```bash
# User query: "how can you help?"
# Expected: final_result with DataPart containing structured JSON
# Actual: partial_result with TextPart containing plain text + JSON string

data: {"kind":"task_artifact_update","artifact":{"name":"partial_result",...
  "parts":[{"kind":"text","text":"I can assist you with...\n{\"is_task_complete\":false,...}"}]}}
```

The structured JSON was being **appended to the text content** instead of being sent as a separate structured artifact.

### Root Cause

The `handle_structured_response()` function in `agent.py` was **defined but never called**:

```python
# File: ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py

def handle_structured_response(self, response_data: dict) -> dict:
    """Parse and validate structured response from LLM."""
    # This function existed but was NEVER CALLED! ❌
    ...
```

The streaming loop in `agent.py` would:
1. ✅ Stream chunks from LLM via `astream()`
2. ✅ Yield each chunk with `is_task_complete: False`
3. ❌ **Never parse the final `AIMessage`** to extract the structured response
4. ❌ **Never yield the parsed response** with actual `is_task_complete` value

As a result, the executor in `agent_executor.py` would:
- Never receive the `is_task_complete: True` event
- Default to sending `partial_result` when stream ended
- Append the JSON string to text content instead of creating a `DataPart`


## Benefits

### 1. Correct A2A Protocol Compliance

- ✅ Sends `final_result` artifact when task is complete
- ✅ Sends `partial_result` artifact only for intermediate updates
- ✅ Properly signals task completion via `TaskState.completed`

### 2. Structured Data Support

- ✅ Clients can receive structured JSON via `DataPart`
- ✅ UI can directly parse `PlatformEngineerResponse` without regex
- ✅ Metadata fields (`user_input`, `input_fields`) are properly typed

### 3. Backward Compatibility

- ✅ Feature flag allows gradual rollout
- ✅ Falls back to `TextPart` if JSON parsing fails
- ✅ Existing clients continue to work

### 4. Better User Experience

- ✅ No more JSON strings appended to text
- ✅ Proper separation of content and metadata
- ✅ Cleaner response formatting in UI


## Testing Strategy

### Manual Testing

1. **Start the Platform Engineer**:
```bash
cd /Users/sraradhy/cisco/eti/sre/cnoe/ai-platform-engineering
docker compose -f docker-compose.dev.yaml up --build caipe-p2p-with-rag
```

2. **Test with curl**:
```bash
curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "id":"test-structured",
    "method":"message/stream",
    "params":{
      "message":{
        "role":"user",
        "parts":[{"kind":"text","text":"how can you help?"}],
        "messageId":"msg-test-structured"
      }
    }
  }'
```

3. **Verify final_result with DataPart**:
```json
{
  "kind": "task_artifact_update",
  "artifact": {
    "name": "final_result",
    "parts": [{
      "kind": "data",
      "data": {
        "is_task_complete": true,
        "require_user_input": false,
        "content": "I can assist you with...",
        "metadata": null
      }
    }]
  }
}
```

### Expected Behavior

#### With ENABLE_STRUCTURED_OUTPUT=true
- ✅ Sends `final_result` (not `partial_result`)
- ✅ Uses `DataPart` with structured JSON
- ✅ Properly sets `is_task_complete: true`
- ✅ Cleanly separates content from metadata

#### With ENABLE_STRUCTURED_OUTPUT=false
- ✅ Sends `final_result` (not `partial_result`)
- ✅ Uses `TextPart` with plain text
- ✅ Properly sets `is_task_complete: true`
- ✅ Backward compatible with old clients

### Integration Tests

```bash
# Run Platform Engineer tests
pytest integration/test_platform_engineer_executor.py -v -k "test_structured_response"

# Verify DataPart handling
pytest integration/test_a2a_protocol.py -v -k "test_data_part"
```


## Related

- [A2A Protocol Specification - DataPart](https://a2a-protocol.org/latest/topics/key-concepts/#core-actors-in-a2a-interactions)
- [A2A Python SDK - DataPart Examples](https://github.com/a2aproject/a2a-python)
- [A2A Samples - Marvin Agent Executor](https://github.com/a2aproject/a2a-samples/blob/main/samples/python/agents/marvin/agent_executor.py)
- [User Input Metadata Format ADR](2025-11-07-user-input-metadata-format.md)
- [Agent Forge - DataPart Handling](https://github.com/cnoe-io/community-plugins/tree/main/workspaces/agent-forge/docs/docs/changes)


## Related

This fix was inspired by the [A2A Marvin agent sample](https://github.com/a2aproject/a2a-samples/blob/e1545d5c6606f798afb28210992fc631f9b7b24a/samples/python/agents/marvin/agent_executor.py#L52-L62), which demonstrates the proper pattern:

```python
# From A2A samples
agent_outcome = await self.agent.invoke(query, task.context_id)
is_task_complete = agent_outcome["is_task_complete"]
content = agent_outcome.get("text_parts", [])
data = agent_outcome.get("data", {})

# Use DataPart if structured data exists
artifact = new_text_artifact(...)
if data:
    artifact = new_data_artifact(
        name="current_result",
        data=data,
    )
```

Our implementation adapts this pattern for streaming agents, parsing the final `AIMessage` after streaming completes.

---

**Key Takeaway**: Always parse the final `AIMessage` from LLM when using structured outputs. Don't assume the streaming loop will automatically extract structured fields like `is_task_complete`.





- Architecture: [architecture.md](./architecture.md)
