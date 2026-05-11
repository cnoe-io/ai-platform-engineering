---
sidebar_position: 1
id: 041-agent-name-tracing-fix-architecture
sidebar_label: Architecture
---

# Architecture: ADR: Agent Name Tracing Fix for LangGraph Observations

**Date**: 2025-12-23

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


## Notes

- This fix applies to all agents inheriting from `BaseLangGraphAgent`
- No changes required in individual agent implementations
- Agent name must be returned by `get_agent_name()` abstract method
- Works with both stdio and HTTP MCP transports
- Compatible with all LLM providers (OpenAI, Anthropic, Bedrock, etc.)



## Related

- Spec: [spec.md](./spec.md)
