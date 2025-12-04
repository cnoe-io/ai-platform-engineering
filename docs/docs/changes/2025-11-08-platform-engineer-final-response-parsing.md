# ADR: Platform Engineer Final Response Parsing and DataPart Implementation

**Status**: 🟢 In-use
**Category**: Bug Fixes & Performance
**Date**: November 8, 2025
**Signed-off-by**: Sri Aradhyula \<sraradhy@cisco.com\>

## Overview

Fixed a critical bug where the Platform Engineer's final `AIMessage` was not being parsed to extract `is_task_complete` from the LLM's structured response. This caused the agent to always send `partial_result` artifacts with plain text instead of `final_result` artifacts with structured JSON data (DataPart).

Additionally implemented proper A2A `DataPart` support for structured responses, controlled by the `ENABLE_STRUCTURED_OUTPUT` feature flag, allowing the Platform Engineer to send structured JSON data to clients that understand it.

## Problem

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

## Solution

### 1. Parse Final AIMessage After Streaming

**File**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py`

Added logic to accumulate streamed content and parse the final `AIMessage`:

```python
# Track streamed content and final message
accumulated_ai_content = []
final_ai_message = None

# Stream responses
async for event in self.deep_agent.astream(message_dict, config):
    for node_name, node_output in event.items():
        for message in messages:
            # Accumulate content from AIMessageChunk
            if isinstance(message, AIMessageChunk):
                if message.content:
                    accumulated_ai_content.append(str(message.content))

            # Store final AIMessage
            if isinstance(message, AIMessage):
                final_ai_message = message

            # Yield streaming chunks
            yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': content,
            }

# CRITICAL FIX: Parse the final AIMessage after streaming completes
if final_ai_message and hasattr(final_ai_message, 'content'):
    try:
        # Parse the structured response from the final message
        parsed_response = self.handle_structured_response(final_ai_message.content)

        # Yield the parsed response with correct is_task_complete
        yield parsed_response

    except Exception as e:
        logger.error(f"Failed to parse final response: {e}")
        # Fallback: yield accumulated content
        yield {
            'is_task_complete': True,
            'require_user_input': False,
            'content': "".join(accumulated_ai_content),
        }
```

### 2. Implement DataPart for Structured Responses

**File**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py`

Added conditional logic to use `DataPart` when `ENABLE_STRUCTURED_OUTPUT=true`:

```python
import json
from a2a.types import Artifact, Part, TextPart, DataPart
from ai_platform_engineering.multi_agents.platform_engineer.response_format import (
    PlatformEngineerResponse,
)

# Check if structured output is enabled
enable_structured_output = os.getenv("ENABLE_STRUCTURED_OUTPUT", "false").lower() == "true"

if enable_structured_output:
    # Try to parse content as JSON matching PlatformEngineerResponse schema
    try:
        response_data = json.loads(content)

        # Validate it matches our schema
        validated_response = PlatformEngineerResponse(**response_data)

        # Create DataPart artifact with structured JSON
        artifact = new_data_artifact(
            name="final_result",
            description="Structured response from Platform Engineer",
            data=response_data,
        )

    except (json.JSONDecodeError, ValidationError):
        # Fallback to TextPart if not valid JSON
        artifact = new_text_artifact(
            name="final_result",
            description="Response from Platform Engineer",
            text=content,
        )
else:
    # Default behavior: always use TextPart
    artifact = new_text_artifact(
        name="final_result",
        description="Response from Platform Engineer",
        text=content,
    )
```

### 3. Feature Flag Configuration

**File**: `docker-compose.dev.yaml`

```yaml
environment:
  # Enable DataPart for structured JSON responses (A2A protocol)
  # When true: Sends structured responses as DataPart if they match PlatformEngineerResponse schema
  # When false: Always sends responses as TextPart (backward compatible)
  ENABLE_STRUCTURED_OUTPUT: "true"
```

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

## Architecture

### Response Flow with Fix

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Deep Agent (LangGraph)                                    │
│    - Streams AIMessageChunk tokens                           │
│    - Final AIMessage contains structured JSON                │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Agent.stream() [NEW FIX]                                  │
│    - Accumulates streamed content                            │
│    - Captures final AIMessage                                │
│    - Calls handle_structured_response() ✨                   │
│    - Yields parsed response with is_task_complete            │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. AgentExecutor.execute()                                   │
│    - Receives is_task_complete: True ✨                      │
│    - Parses JSON from content                                │
│    - Creates DataPart (if ENABLE_STRUCTURED_OUTPUT=true)     │
│    - Sends final_result artifact ✨                          │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. A2A Client (Agent Forge / agent-chat-cli)                 │
│    - Receives DataPart with structured JSON                  │
│    - Parses PlatformEngineerResponse                         │
│    - Renders metadata UI                                     │
└─────────────────────────────────────────────────────────────┘
```

### PlatformEngineerResponse Schema

```python
class PlatformEngineerResponse(BaseModel):
    """Structured response format for Platform Engineer."""

    is_task_complete: bool
    require_user_input: bool
    content: str
    metadata: Optional[PlatformEngineerMetadata] = None

class PlatformEngineerMetadata(BaseModel):
    """Metadata for user input requests."""

    user_input: Optional[bool] = False
    input_fields: Optional[List[PlatformEngineerInputField]] = None
```

## Why Sub-Agents Don't Need This Fix

Sub-agents (Jira, ArgoCD, AWS) using `BaseLangGraphAgent` **already work correctly**:

```python
# File: ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py

async def stream(...):
    # Stream chunks
    async for state in self.graph.astream(...):
        yield {
            'is_task_complete': False,
            'require_user_input': False,
            'content': content,
        }

    # ALWAYS yield task completion at the end
    yield {
        'is_task_complete': True,  # ✅ Hardcoded!
        'require_user_input': False,
        'content': '',
    }
```

**Key Difference**:
- **Sub-agents**: Hardcode `is_task_complete: True` when streaming ends
- **Platform Engineer**: Relies on LLM's structured response (which wasn't being parsed)

## Files Modified

### Core Fix
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py`
  - Added `accumulated_ai_content` and `final_ai_message` tracking
  - Added post-streaming parsing logic
  - Now calls `handle_structured_response()` on final message

### DataPart Implementation
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py`
  - Added imports: `DataPart`, `TextPart`, `PlatformEngineerResponse`
  - Added conditional `DataPart` vs `TextPart` logic
  - Validates JSON against schema before creating `DataPart`

### Configuration
- `docker-compose.dev.yaml`
  - Added `ENABLE_STRUCTURED_OUTPUT` environment variable
  - Set to `true` for `caipe-p2p-with-rag` (RAG-enabled agent)
  - Set to `false` for `caipe-p2p-no-rag` (backward compatibility)

## Testing

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

## Verification

Code analysis confirms these features are **actively in use**:

- ✅ `handle_structured_response()` is now **called** in `agent.py` (line ~195)
- ✅ `accumulated_ai_content` and `final_ai_message` tracking implemented
- ✅ `DataPart` support added to `agent_executor.py`
- ✅ `ENABLE_STRUCTURED_OUTPUT` flag configured in `docker-compose.dev.yaml`
- ✅ `PlatformEngineerResponse` schema enforced via `response_format` in `deep_agent.py`
- ✅ Feature deployed and tested with curl

## Performance Impact

### Before Fix
- ❌ Always sent `partial_result` (never `final_result`)
- ❌ JSON appended to text as string
- ❌ UI had to parse JSON from text with regex
- ❌ No proper task completion signaling

### After Fix
- ✅ Correctly sends `final_result` when task is complete
- ✅ Structured JSON sent as `DataPart`
- ✅ UI receives typed data (no parsing needed)
- ✅ Proper A2A protocol compliance

**No performance degradation** - parsing happens once after streaming completes.

## Related Documentation

- [A2A Protocol Specification - DataPart](https://a2a-protocol.org/latest/topics/key-concepts/#core-actors-in-a2a-interactions)
- [A2A Python SDK - DataPart Examples](https://github.com/a2aproject/a2a-python)
- [A2A Samples - Marvin Agent Executor](https://github.com/a2aproject/a2a-samples/blob/main/samples/python/agents/marvin/agent_executor.py)
- [User Input Metadata Format ADR](2025-11-07-user-input-metadata-format.md)
- [Agent Forge - DataPart Handling](https://github.com/cnoe-io/community-plugins/tree/main/workspaces/agent-forge/docs/docs/changes)

## References

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



