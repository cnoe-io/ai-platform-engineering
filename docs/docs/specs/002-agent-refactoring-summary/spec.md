---
sidebar_position: 2
sidebar_label: Specification
title: "2024-10-22: Agent Refactoring: Unified BaseLangGraphAgent Implementation"
---

# Agent Refactoring: Unified BaseLangGraphAgent Implementation

**Status**: 🟢 In-use
**Category**: Refactoring & Implementation
**Date**: October 21, 2024

## Overview

Refactored **8 agents** to use the common `BaseLangGraphAgent` base class, eliminating code duplication and ensuring consistent behavior across all agents.


## Benefits

### 1. **Automatic Tool Visibility** 🔧

All refactored agents now automatically show:
```
🔧 Calling tool: **list_clusters**
✅ Tool **list_clusters** completed
🔧 Calling tool: **get_cluster_details**
✅ Tool **get_cluster_details** completed
```

**Before refactoring**: No tool visibility, just "Processing..."

### 2. **Consistent Structure** 📐

All agents now follow the **exact same pattern**:

```python
class AgentName(BaseLangGraphAgent):
    """Agent description."""

    SYSTEM_INSTRUCTION = "..."  # Agent-specific prompt
    RESPONSE_FORMAT_INSTRUCTION = "..."  # Standard format

    def get_agent_name(self) -> str:
        return "agent_name"

    def get_system_instruction(self) -> str:
        return self.SYSTEM_INSTRUCTION

    def get_response_format_instruction(self) -> str:
        return self.RESPONSE_FORMAT_INSTRUCTION

    def get_response_format_class(self) -> type[BaseModel]:
        return ResponseFormat

    def get_mcp_config(self, server_path: str) -> dict:
        # Agent-specific MCP configuration
        return {...}

    def get_tool_working_message(self) -> str:
        return 'Querying Agent...'

    def get_tool_processing_message(self) -> str:
        return 'Processing Agent data...'

    @trace_agent_stream("agent_name")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        async for event in super().stream(query, sessionId, trace_id):
            yield event
```

**Only 3 things differ**:
1. System instruction (prompt)
2. MCP configuration (env vars, tools)
3. Agent name

### 3. **Reduced Code Duplication** 📉

- **3,460 lines removed** across all agents
- **750 lines added** (clean, consistent implementations)
- **78% code reduction overall**
- **2,710 net lines deleted**

### 4. **Easier Maintenance** 🛠️

**Before**:
- Bug fix needs to be applied to 8 different files
- Each agent has slightly different implementation
- Inconsistent error handling

**After**:
- Bug fix in `BaseLangGraphAgent` fixes all 8 agents
- All agents behave identically
- Consistent error handling and streaming

### 5. **Future Enhancements Automatic** 🚀

Any improvements to `BaseLangGraphAgent` automatically apply to all agents:
- ✅ Tool visibility (already added!)
- ✅ Better error handling
- ✅ Performance optimizations
- ✅ New A2A protocol features


## Testing Strategy

All agents can be tested with the same pattern:

```bash
# Test any agent
curl -X POST http://localhost:8001 \
  -H "Content-Type: application/json" \
  -d '{"query": "list resources"}'

# Check logs for tool visibility
docker logs agent-argocd-p2p 2>&1 | grep -E "(Tool call detected|Tool result)" | tail -5
```

**Expected output**:
```
argocd: Tool call detected - list_applications
argocd: Tool result received - list_applications (success)
```


## Related

- [A2A Intermediate States](./2024-10-22-a2a-intermediate-states.md) - Tool visibility implementation
- [Enhanced Streaming Feature](./2024-10-22-enhanced-streaming-feature.md) - Parallel streaming
- [Streaming Architecture](./2024-10-22-streaming-architecture.md) - Technical deep dive


- Architecture: [architecture.md](./architecture.md)
