# Remove Agent Initialization Capabilities Greeting

**Status**: 🟢 In-use
**Date**: 2025-11-10
**Author**: Sri Aradhyula
**Scope**: Agent Initialization, A2A Protocol

## Context

During agent initialization, `BaseLangGraphAgent._setup_mcp_and_graph()` was invoking the agent graph with a "Summarize what you can do?" query to generate and log a capabilities summary. This initialization query was creating an unwanted side effect where the capabilities greeting message was appearing in the `complete_result` artifact sent to clients.

### Problem

When agents were initialized, they would:
1. Run `graph.ainvoke({"messages": HumanMessage(content="Summarize what you can do?")})`
2. Generate a capabilities summary (e.g., "I can assist you with managing and interacting with Argo Workflows services...")
3. Log the capabilities for debugging purposes
4. **Unintended**: This greeting would persist and appear in the `complete_result` artifact for agent-forge and other clients

This resulted in users seeing an unnecessary greeting message in the complete_result:
```json
{
  "is_task_complete": true,
  "require_user_input": false,
  "content": "I can assist you with managing and interacting with Argo Workflows services. My capabilities include:\n\n1. Managing Resources and Configurations...",
  "metadata": null
}
```

## Decision

**Remove the initialization capabilities summary query entirely.**

The capabilities greeting was only intended for logging/debugging during agent startup, but it was interfering with normal agent responses. Instead of trying to isolate the test query from production queries, we've removed it entirely.

### Changes Made

**Before:**
```python
# Initialize with a capabilities summary
runnable_config = RunnableConfig(configurable={"thread_id": "test-thread"})
llm_result = await self.graph.ainvoke(
    {"messages": HumanMessage(content="Summarize what you can do?")},
    config=runnable_config
)

# Extract meaningful content from LLM result
ai_content = None
for msg in reversed(llm_result.get("messages", [])):
    if hasattr(msg, "type") and msg.type in ("ai", "assistant") and getattr(msg, "content", None):
        ai_content = msg.content
        break
    # ... more extraction logic

logger.info(f"✅ {agent_name} agent initialized with {len(tools)} tools")

if ai_content:
    logger.info("=" * 50)
    logger.info(f"Agent {agent_name.upper()} Capabilities:")
    logger.info(ai_content)
    logger.info("=" * 50)
```

**After:**
```python
# Agent initialization complete
logger.info(f"✅ {agent_name} agent initialized with {len(tools)} tools")
```

### Files Modified

1. `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py`
2. `cnoe_agent_utils/agents/base_langgraph_agent.py`
3. `ai_platform_engineering/agents/template/agent_petstore/protocol_bindings/a2a_server/agent.py` (template cleanup)

## Consequences

### Positive

✅ **Cleaner complete_result**: Clients no longer receive unwanted greeting messages
✅ **Faster initialization**: Agents initialize quicker without the extra LLM invocation
✅ **No memory pollution**: The "test-thread" thread_id no longer persists in checkpointer memory
✅ **Cost savings**: One less LLM call per agent initialization

### Negative

⚠️ **Less verbose logs**: We no longer log the detailed capabilities summary during startup
⚠️ **Manual capability verification**: Developers must manually query agents to see capabilities

### Neutral

- Agent functionality remains unchanged
- Agents still respond correctly to user queries
- MCP tools are still properly initialized and available

## Alternatives Considered

### Alternative 1: Use Isolated Thread for Test Query
Keep the capabilities query but ensure it doesn't persist:
```python
# Use disposable thread that won't interfere with production
test_config = RunnableConfig(configurable={"thread_id": f"init-test-{uuid4()}"})
```
**Rejected because**: Still requires an extra LLM call and adds complexity

### Alternative 2: Mock/Skip for Agent-Forge
Add configuration to skip initialization query for specific deployments
**Rejected because**: Adds unnecessary configuration complexity

### Alternative 3: Extract Capabilities from System Prompt
Parse the system prompt to extract capabilities description
**Rejected because**: Requires parsing logic and may not reflect actual tool availability

## Implementation Notes

### Testing

After this change, verify:
1. Agents initialize successfully without errors
2. `complete_result` artifacts no longer contain greeting messages
3. Agents respond correctly to first user query
4. Agent logs show "✅ {agent_name} agent initialized with X tools"

### Rollback Plan

If issues arise, revert commits to both files:
- `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py`
- `cnoe_agent_utils/agents/base_langgraph_agent.py`

## Related

- **agent-forge**: Frontend client consuming A2A protocol
- **A2A Protocol**: Complete result artifact specification
- **BaseLangGraphAgent**: Base class for all LangGraph agents
- **MCP Integration**: Agent tool initialization

## Monitoring

Watch for:
- Agent initialization errors
- Unexpected behavior in first user query
- Complete result artifacts containing greeting messages (should not occur)

---

**Signed-off-by**: Sri Aradhyula <sraradhy@cisco.com>

