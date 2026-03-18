---
sidebar_position: 2
sidebar_label: Specification
title: "2025-12-23: ADR: Agent Name Tracing Fix for LangGraph Observations"
---

# ADR: Agent Name Tracing Fix for LangGraph Observations

**Status**: 🟢 In-use
**Category**: Bug Fixes & Performance
**Date**: December 23, 2025
**Signed-off-by**: Sri Aradhyula &lt;sraradhy@cisco.com&gt;

## Overview

Fixed LangGraph observation names in Langfuse traces to display the actual agent name (e.g., "argocd", "jira", "aws") instead of the generic "agent" name. This improves observability and makes it easier to track which specific agent is executing in distributed traces.

The issue was that `create_react_agent()` from LangGraph was creating nodes with generic names ("agent", "call_model", etc.), which showed up in Langfuse as generic observation names. By configuring the LLM model with the agent name before passing it to `create_react_agent()`, we now get properly named observations in traces.


## Motivation

### Issue
When viewing Langfuse traces for agent execution, all LangGraph observations showed generic names like "agent" instead of the actual agent name (e.g., "backstage", "argocd", "platform_engineer"). This made it difficult to:

1. **Identify which agent was executing** in multi-agent workflows
2. **Debug agent-specific issues** in traces
3. **Analyze performance metrics** per agent
4. **Track agent execution flow** in distributed tracing

### Root Cause
The `create_react_agent()` function from LangGraph creates a graph with predefined generic node names:
- "agent" (the main agent node)
- "call_model" (model invocation)
- "tools" (tool execution)
- "should_continue" (routing logic)

These node names were being used as observation names in Langfuse traces. While the top-level span name was correct (set by cnoe-agent-utils' `@trace_agent_stream` decorator), the internal LangGraph observations used generic names.

### Example from Trace
Looking at trace `fb5d2377456a4fd6bdab08ac76d9f75c`:

```json
{
  "trace": {
    "name": "ai-platform-engineer",  // ✅ Correct
    "observations": [
      {
        "name": "🤖-platform_engineer-agent",  // ✅ Correct (span name)
      },
      {
        "name": "agent",  // ❌ Generic (should be "platform_engineer")
      },
      {
        "name": "call_model",  // ❌ Generic
      }
    ]
  }
}
```


## Benefits

1. **Improved Observability**
   - Traces now clearly show which agent is executing (e.g., "argocd", "jira", "aws")
   - Easy to identify agent-specific issues in Langfuse dashboard
   - Better correlation between agent names and performance metrics

2. **Better Debugging**
   - Quick identification of failing agents in multi-agent workflows
   - Clear agent attribution in error logs
   - Easier root cause analysis for agent-specific bugs

3. **Enhanced Metrics**
   - Filter Langfuse traces by agent name using tags
   - Analyze performance metrics per agent
   - Track agent usage patterns and frequency

4. **Consistent Naming**
   - Agent names now consistent across:
     - Environment variables (`AGENT_NAME`)
     - cnoe-agent-utils tracing
     - LangGraph observations
     - Langfuse trace UI

5. **Zero Performance Impact**
   - Configuration is applied once during graph creation
   - No runtime overhead
   - No changes to agent execution logic


## Testing Strategy

### Verification Steps

1. **Start an agent with tracing enabled**:
```bash
cd ai_platform_engineering/multi_agents/platform_engineer
export ENABLE_TRACING=true
export LANGFUSE_PUBLIC_KEY=<your-key>
export LANGFUSE_SECRET_KEY=<your-secret>
export LANGFUSE_HOST=http://localhost:3000
python -m protocol_bindings.a2a.agent_executor
```

2. **Send a test query**:
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "add swyekasi@cisco.com to backstage access ad group",
    "user_email": "sraradhy@cisco.com"
  }'
```

3. **Check Langfuse trace** at `http://localhost:3000`:
   - Navigate to Traces
   - Find the trace for your query
   - Expand observations
   - Verify observation names show actual agent names instead of "agent"

### Expected Results

**Before Fix**:
```
🤖-platform_engineer-agent (span)
  └── agent (observation) ❌ Generic
      ├── call_model ❌ Generic
      ├── tools
      └── should_continue
```

**After Fix**:
```
🤖-platform_engineer-agent (span)
  └── platform_engineer (observation) ✅ Agent-specific
      ├── platform_engineer_call_model ✅ Agent-specific
      ├── platform_engineer_tools ✅ Agent-specific
      └── platform_engineer_should_continue ✅ Agent-specific
```

### Integration Tests

The existing integration tests continue to pass with this change:

```bash
# Run platform engineer tests
pytest integration/test_platform_engineer_executor.py -v

# Run agent-specific tests
pytest integration/test_argocd_agent.py -v
pytest integration/test_aws_agent.py -v
pytest integration/test_jira_agent.py -v
```

### Manual Verification for All Agents

Test each agent type to verify proper naming:

```bash
# ArgoCD Agent
curl -X POST http://localhost:8000/chat \
  -d '{"message": "list argocd applications"}'
# Check trace shows "argocd" observations

# AWS Agent
curl -X POST http://localhost:8000/chat \
  -d '{"message": "list AWS EC2 instances"}'
# Check trace shows "aws" observations

# Jira Agent
curl -X POST http://localhost:8000/chat \
  -d '{"message": "search jira tickets"}'
# Check trace shows "jira" observations
```


## Related

### Backend ADRs
- [Agent Refactoring Summary](../agent-refactoring-summary/spec) - Base agent architecture
- [Tracing Implementation Guide](../../evaluations/tracing-implementation-guide) - Langfuse integration

### cnoe-agent-utils
- TracingManager Documentation - See `cnoe-agent-utils/TRACING.md` in repository
- `@trace_agent_stream` Decorator - See `cnoe-agent-utils/cnoe_agent_utils/tracing/decorators.py` in repository

### External Resources
- [LangGraph Tracing](https://python.langchain.com/docs/langgraph/how-tos/trace) - LangGraph observability
- [Langfuse](https://langfuse.com/) - Tracing platform
- [LangChain Model Configuration](https://python.langchain.com/docs/how_to/configure/) - `with_config()` usage

---


- Architecture: [architecture.md](./architecture.md)
