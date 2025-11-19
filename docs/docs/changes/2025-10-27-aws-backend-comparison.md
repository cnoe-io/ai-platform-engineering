# AWS Agent Backend Implementations

**Status**: 🟢 In-use (Part of consolidated AWS integration)
**Category**: Integrations
**Date**: October 27, 2025 (Consolidated into 2025-11-05-aws-integration.md)

The AWS agent supports two backend implementations:

## 1. LangGraph Backend (Default) ✨

**File:** `agent_aws/agent_langgraph.py`

### Features:
- ✅ **Tool Call Notifications**: Shows `🔧 Calling tool: {ToolName}` and `✅ Tool {ToolName} completed`
- ✅ **Token-by-Token Streaming**: Fine-grained streaming when `ENABLE_STREAMING=true`
- ✅ **Consistent with Other Agents**: Same behavior as ArgoCD, GitHub, Jira agents
- ✅ **LangGraph Ecosystem**: Full access to LangGraph features

### Usage:
```bash
# Default - no configuration needed
docker-compose -f docker-compose.dev.yaml up agent-aws-p2p

# Or explicitly set
export AWS_AGENT_BACKEND=langgraph
export ENABLE_STREAMING=true
```

### Example Output:
```
🔧 Aws: Calling tool: List_Clusters
✅ Aws: Tool List_Clusters completed

Found 3 EKS clusters in us-west-2:
- prod-cluster
- staging-cluster
- dev-cluster
```

---

## 2. Strands Backend (Alternative)

**File:** `agent_aws/agent.py`

### Features:
- ✅ **Chunk-Level Streaming**: Built-in streaming (always on)
- ✅ **Mature**: Original implementation, well-tested
- ✅ **Simple**: Fewer dependencies
- ❌ **No Tool Notifications**: Tools are called internally (not visible)
- ❌ **No Token-Level Streaming**: Streams in larger chunks

### Usage:
```bash
export AWS_AGENT_BACKEND=strands
docker-compose -f docker-compose.dev.yaml up agent-aws-p2p
```

### Example Output:
```
Found 3 EKS clusters in us-west-2:
- prod-cluster
- staging-cluster
- dev-cluster
```

---

## Comparison Table

| Feature | LangGraph (Default) | Strands |
|---------|---------------------|---------|
| **Tool Notifications** | ✅ Yes (`🔧`, `✅`) | ❌ No (internal) |
| **Token Streaming** | ✅ Yes (with `ENABLE_STREAMING=true`) | ⚠️  Chunk-level only |
| **Streaming Control** | ✅ Via `ENABLE_STREAMING` | ❌ Always on (chunks) |
| **Agent Name in Messages** | ✅ Yes | ❌ No |
| **Consistency** | ✅ Matches other agents | ⚠️  Different format |
| **Maturity** | ✨ New | ✅ Well-tested |
| **Dependencies** | LangGraph, LangChain | Strands SDK |

---

## Environment Variables

### AWS Agent Backend Selection
```bash
# Choose the backend implementation
AWS_AGENT_BACKEND=langgraph  # default
# or
AWS_AGENT_BACKEND=strands
```

### Streaming Configuration (LangGraph only)
```bash
# Enable token-by-token streaming
ENABLE_STREAMING=true  # default for AWS agent
```

### MCP Configuration (Both backends)
```bash
# Enable/disable AWS MCP servers
ENABLE_EKS_MCP=true
ENABLE_COST_EXPLORER_MCP=true
ENABLE_IAM_MCP=true
ENABLE_TERRAFORM_MCP=false
ENABLE_AWS_DOCUMENTATION_MCP=false
ENABLE_CLOUDTRAIL_MCP=true
ENABLE_CLOUDWATCH_MCP=true
```

---

## Recommendation

**Use LangGraph backend (default)** for:
- ✅ Consistent user experience across all agents
- ✅ Better visibility into tool execution
- ✅ Finer-grained streaming control
- ✅ Better integration with Backstage plugin

**Use Strands backend** only if:
- You need the original implementation for compatibility
- You're debugging issues with the LangGraph implementation
- You prefer a simpler dependency tree

---

## Implementation Details

The executor automatically selects the backend in `agent_executor.py`:

```python
backend = os.getenv("AWS_AGENT_BACKEND", "langgraph").lower()

if backend == "strands":
    # Use Strands SDK implementation
    from ai_platform_engineering.utils.a2a_common.base_strands_agent_executor import BaseStrandsAgentExecutor
    from agent_aws.agent import AWSAgent
    return BaseStrandsAgentExecutor(AWSAgent())
else:
    # Use LangGraph implementation (default)
    from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor
    from agent_aws.agent_langgraph import AWSAgentLangGraph
    return BaseLangGraphAgentExecutor(AWSAgentLangGraph())
```

---

## Testing Both Implementations

### Test LangGraph Backend (Default):
```bash
curl -X POST http://localhost:8002 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"id":"test","method":"message/stream","params":{"message":{"role":"user","parts":[{"kind":"text","text":"list EKS clusters"}]}}}'

# Look for tool notifications:
# 🔧 Aws: Calling tool: ...
# ✅ Aws: Tool ... completed
```

### Test Strands Backend:
```bash
export AWS_AGENT_BACKEND=strands
# Restart agent
docker-compose -f docker-compose.dev.yaml restart agent-aws-p2p

curl -X POST http://localhost:8002 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"id":"test","method":"message/stream","params":{"message":{"role":"user","parts":[{"kind":"text","text":"list EKS clusters"}]}}}'

# No tool notifications, just chunked content
```







