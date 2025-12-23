# ADR: Agent Name Tracing Fix for LangGraph Observations

**Status**: 🟢 In-use
**Category**: Bug Fixes & Performance
**Date**: December 23, 2025
**Signed-off-by**: Sri Aradhyula <sraradhy@cisco.com>

## Overview / Summary

Fixed LangGraph observation names in Langfuse traces to display the actual agent name (e.g., "argocd", "jira", "aws") instead of the generic "agent" name. This improves observability and makes it easier to track which specific agent is executing in distributed traces.

The issue was that `create_react_agent()` from LangGraph was creating nodes with generic names ("agent", "call_model", etc.), which showed up in Langfuse as generic observation names. By configuring the LLM model with the agent name before passing it to `create_react_agent()`, we now get properly named observations in traces.

## Problem / Problem Statement

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

## Solution / Solution Design / Implementation

### Solution Approach
Configure the LLM model with the agent name using `with_config()` before passing it to `create_react_agent()`. This ensures LangGraph uses the agent name for all observations.

### Implementation

**File**: `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py`

#### Before (Lines 607-619):
```python
# Create the react agent graph
logger.info(f"🔧 Creating {agent_name} agent graph with {len(tools)} tools...")

self.graph = create_react_agent(
    self.model,  # ❌ Model without agent name configuration
    tools,
    checkpointer=memory,
    prompt=self._get_system_instruction_with_date(),
    response_format=(
        self.get_response_format_instruction(),
        self.get_response_format_class()
    ),
)
```

#### After (Lines 607-625):
```python
# Create the react agent graph
logger.info(f"🔧 Creating {agent_name} agent graph with {len(tools)} tools...")

# Configure model with agent name for proper tracing
# This ensures LangGraph observations show the agent name instead of generic "agent"
model_with_name = self.model.with_config(
    run_name=agent_name,
    tags=[f"agent:{agent_name}"],
    metadata={"agent_name": agent_name}
)

self.graph = create_react_agent(
    model_with_name,  # ✅ Model configured with agent name
    tools,
    checkpointer=memory,
    prompt=self._get_system_instruction_with_date(),
    response_format=(
        self.get_response_format_instruction(),
        self.get_response_format_class()
    ),
)
```

### How It Works

1. **`model.with_config()`**: Creates a copy of the model with additional configuration
   - `run_name`: Sets the name used for tracing/observability
   - `tags`: Adds searchable tags for filtering traces
   - `metadata`: Stores additional context for debugging

2. **LangGraph Integration**: When `create_react_agent()` uses the configured model, LangGraph's tracing system picks up the `run_name` and uses it for observations

3. **Backwards Compatibility**: The model itself is unchanged; only its configuration wrapper is modified, so all existing functionality remains intact

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

## Testing / Verification

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

## Files Modified

```
ai_platform_engineering/
└── utils/
    └── a2a_common/
        └── base_langgraph_agent.py (lines 607-625)
            - Added model configuration with agent name
            - Created model_with_name wrapper
            - Updated create_react_agent() call
```

## Verification

Code analysis confirms this fix is **actively in use**:

✅ **File Modified**: `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py`
- `model.with_config()` method called in `_setup_mcp_and_graph()` (line 611-615)
- `run_name`, `tags`, and `metadata` configured with agent name
- Applied to all agents inheriting from `BaseLangGraphAgent`

✅ **Agents Using Fix**:
- `AWSAgentLangGraph` (aws/agent_aws/agent_langgraph.py)
- `ArgocdAgentLangGraph` (argocd/agent_argocd/agent.py)
- `BackstageAgent` (backstage/agent_backstage/agent.py)
- `JiraAgent` (jira/agent_jira/agent.py)
- `SlackAgent` (slack/agent_slack/agent.py)
- `SplunkAgent` (splunk/agent_splunk/agent.py)
- `PagerDutyAgent` (pagerduty/agent_pagerduty/agent.py)
- `ConfluenceAgent` (confluence/agent_confluence/agent.py)
- All agents inheriting from `BaseLangGraphAgent`

✅ **Integration with cnoe-agent-utils**:
- Works seamlessly with `@trace_agent_stream()` decorator
- Complements top-level span naming from TracingManager
- Agent name sourced from `get_agent_name()` abstract method

✅ **No Linter Errors**: Code passes all ruff and black checks

## Performance Impact

### Before
- Generic observation names in traces
- Difficult to filter by agent
- Hard to identify agent-specific issues

### After
- Agent-specific observation names
- Easy filtering by agent name
- Clear agent attribution in traces
- **Zero performance overhead** (configuration applied once at initialization)

## Related Documentation

### Backend ADRs
- [Agent Refactoring Summary](./2024-10-22-agent-refactoring-summary.md) - Base agent architecture
- [Tracing Implementation Guide](../evaluations/tracing-implementation-guide.md) - Langfuse integration

### cnoe-agent-utils
- [TracingManager Documentation](../../../../../cnoe-agent-utils/TRACING.md) - Tracing utility
- [`@trace_agent_stream` Decorator](../../../../../cnoe-agent-utils/cnoe_agent_utils/tracing/decorators.py) - Span creation

### External Resources
- [LangGraph Tracing](https://python.langchain.com/docs/langgraph/how-tos/trace) - LangGraph observability
- [Langfuse](https://langfuse.com/) - Tracing platform
- [LangChain Model Configuration](https://python.langchain.com/docs/how_to/configure/) - `with_config()` usage

---

## Notes

- This fix applies to all agents inheriting from `BaseLangGraphAgent`
- No changes required in individual agent implementations
- Agent name must be returned by `get_agent_name()` abstract method
- Works with both stdio and HTTP MCP transports
- Compatible with all LLM providers (OpenAI, Anthropic, Bedrock, etc.)

