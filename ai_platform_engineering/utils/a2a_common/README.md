# A2A (Agent-to-Agent) Base Classes

This directory contains base classes for building agents with A2A protocol support. Two patterns are available:

## 1. LangGraph-based Pattern (Most Agents)

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

## 2. Strands-based Pattern (AWS Agent)

**Best for:** Enterprise agents, multi-MCP servers, AWS Bedrock integration

### Components
- `BaseStrandsAgent` - Abstract base for Strands agents
- `BaseStrandsAgentExecutor` - Handles Strands → A2A protocol bridging

### Used by
- AWS Agent (EKS, Cost Explorer, IAM)

### Example
```python
from typing import List, Tuple
from ai_platform_engineering.utils.a2a_common.base_strands_agent import BaseStrandsAgent
from strands.tools.mcp import MCPClient
from mcp import stdio_client, StdioServerParameters

class MyAgent(BaseStrandsAgent):
    def get_agent_name(self) -> str:
        return "my_agent"

    def get_system_prompt(self) -> str:
        return "You are a helpful assistant..."

    def create_mcp_clients(self) -> List[Tuple[str, MCPClient]]:
        client = MCPClient(lambda: stdio_client(
            StdioServerParameters(
                command="uvx",
                args=["my-mcp-server@latest"],
                env={}
            )
        ))
        return [("my_server", client)]

    def get_model_config(self):
        # Return Strands model configuration
        return None  # Uses default
```

## Architecture Comparison

| Feature | LangGraph Pattern | Strands Pattern |
|---------|------------------|-----------------|
| Framework | LangGraph | Strands SDK |
| MCP Client | langchain_mcp_adapters | Strands MCPClient |
| Execution | Fully async | Sync with async bridge |
| Multi-server | Single (typical) | Native multi-server |
| State Management | LangGraph checkpointing | Manual |
| Best For | Platform tools | Enterprise AWS |

## Key Files

```
utils/a2a_common/
├── base_langgraph_agent.py         # LangGraph base class
├── base_langgraph_agent_executor.py # LangGraph → A2A executor
├── base_strands_agent.py           # Strands base class
├── base_strands_agent_executor.py  # Strands → A2A executor
├── state.py                        # Shared state types
├── helpers.py                      # Utility functions
└── README.md                       # This file
```

## When to Use Which Pattern?

### Choose **LangGraph** (`BaseLangGraphAgent`) when:
✅ Building platform tool agents (Jira, Slack, GitHub, etc.)
✅ Single MCP server is sufficient
✅ Want full async/await throughout
✅ Need LangChain ecosystem features
✅ Prefer graph-based reactive architecture

### Choose **Strands** (`BaseStrandsAgent`) when:
✅ Building enterprise-grade agents
✅ Need multiple MCP servers simultaneously
✅ Require AWS Bedrock integration
✅ Want synchronous control flow with streaming
✅ Need proven production patterns

## Common Interface

Both patterns provide similar external interfaces:

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

1. **Choose your pattern** (LangGraph or Strands)
2. **Extend the base class** (`BaseLangGraphAgent` or `BaseStrandsAgent`)
3. **Implement required methods**
4. **Create an executor** (extends `BaseLangGraphAgentExecutor` or `BaseStrandsAgentExecutor`)
5. **Set up A2A server** using the executor

See individual README files in agent directories for detailed examples:
- LangGraph example: `agents/jira/agent_jira/protocol_bindings/a2a_server/`
- Strands example: `agents/aws/agent_aws/protocol_bindings/a2a_server/`

## Important: Import Only What You Need

To avoid unnecessary dependencies, **do not** import from `ai_platform_engineering.utils.a2a_common` directly.

Instead, import from the specific module:

```python
# ✅ Good - only installs LangGraph dependencies
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor

# ✅ Good - only installs Strands dependencies
from ai_platform_engineering.utils.a2a_common.base_strands_agent import BaseStrandsAgent
from ai_platform_engineering.utils.a2a_common.base_strands_agent_executor import BaseStrandsAgentExecutor

# ❌ Bad - would require both LangGraph AND Strands (deprecated)
# from ai_platform_engineering.utils.a2a_common import BaseLangGraphAgent, BaseStrandsAgent
```

## Migration Notes

If you have an existing agent and want to use these base classes:

### For LangGraph agents:
1. Import from `.base_langgraph_agent` module
2. Extend `BaseLangGraphAgent` instead of creating from scratch
3. Move MCP configuration to `get_mcp_config()`
4. Move system prompt to `get_system_instruction()`
5. Use `BaseLangGraphAgentExecutor` for A2A bridging

### For Strands agents:
1. Import from `.base_strands_agent` module
2. Extend `BaseStrandsAgent`
3. Move MCP client creation to `create_mcp_clients()`
4. Move system prompt to `get_system_prompt()`
5. Move model config to `get_model_config()`
6. Use `BaseStrandsAgentExecutor` for A2A bridging

## Testing

Both patterns support the same testing approach:

```python
# Test the agent directly
agent = MyAgent()
result = agent.chat("test query")
assert "expected" in result["answer"]

# Test with A2A executor
executor = MyAgentExecutor()
# ... test with A2A context and event queue
```

