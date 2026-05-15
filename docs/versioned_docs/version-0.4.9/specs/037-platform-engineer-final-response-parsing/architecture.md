---
sidebar_position: 1
id: 037-platform-engineer-final-response-parsing-architecture
sidebar_label: Architecture
---

# Architecture: ADR: Platform Engineer Final Response Parsing and DataPart Implementation

**Date**: 2025-11-08

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


## Related

- Spec: [spec.md](./spec.md)
