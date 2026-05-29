# A2A (Agent-to-Agent) Base Classes

This directory contains base classes for building LangGraph agents with A2A protocol support.

## LangGraph-based Pattern

**Best for:** Simple agents with single MCP servers, LangChain integration

### Components
- `BaseLangGraphAgent` - Abstract base for LangGraph agents
- `BaseLangGraphAgentExecutor` - Handles LangGraph → A2A protocol bridging

### Used by
- Jira, Slack, GitHub, ArgoCD, Confluence, PagerDuty, Webex, Backstage, etc.

### Example
```python
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent

class MyAgent(BaseLangGraphAgent):
    def get_agent_name(self) -> str:
        return "my_agent"

    def get_system_instruction(self) -> str:
        return "You are a helpful assistant..."

    def get_mcp_config(self, server_path: str) -> dict:
        return {
            "command": "uv",
            "args": ["run", server_path],
            "transport": "stdio"
        }

    # ... other required methods
```

## Key Files

```
utils/a2a_common/
├── base_langgraph_agent.py         # LangGraph base class
├── base_langgraph_agent_executor.py # LangGraph → A2A executor
├── state.py                        # Shared state types
├── helpers.py                      # Utility functions
└── README.md                       # This file
```

## Common Interface

Agents provide these external interfaces:

```python
# Chat (non-streaming)
result = agent.chat("What is the weather?")

# Streaming
for event in agent.stream_chat("What is the weather?"):
    print(event)

# A2A Protocol
executor = MyAgentExecutor()
await executor.execute(context, event_queue)
```

## Creating a New Agent

1. **Extend the base class** (`BaseLangGraphAgent`)
2. **Implement required methods**
3. **Create an executor** (extends `BaseLangGraphAgentExecutor`)
4. **Set up A2A server** using the executor

See individual README files in agent directories for detailed examples:
- LangGraph example: `agents/jira/agent_jira/protocol_bindings/a2a_server/`

## Important: Import Only What You Need

To avoid unnecessary dependencies, **do not** import from `ai_platform_engineering.utils.a2a_common` directly.

Instead, import from the specific module:

```python
# ✅ Good - only installs LangGraph dependencies
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor

# ❌ Bad - base classes are intentionally not re-exported here
# from ai_platform_engineering.utils.a2a_common import BaseLangGraphAgent
```

## Migration Notes

If you have an existing agent and want to use these base classes:

1. Import from `.base_langgraph_agent` module
2. Extend `BaseLangGraphAgent` instead of creating from scratch
3. Move MCP configuration to `get_mcp_config()`
4. Move system prompt to `get_system_instruction()`
5. Use `BaseLangGraphAgentExecutor` for A2A bridging

## Testing

LangGraph agents support this testing approach:

```python
# Test the agent directly
agent = MyAgent()
result = agent.chat("test query")
assert "expected" in result["answer"]

# Test with A2A executor
executor = MyAgentExecutor()
# ... test with A2A context and event queue
```
