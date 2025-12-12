# Creating an Agent

This guide will walk you through creating a new AI agent from scratch using the CAIPE platform.

## Overview

An agent in CAIPE is an LLM-powered service that:

- Uses **LangGraph** for orchestration (ReAct pattern)
- Communicates via **A2A protocol** (Agent-to-Agent)
- Connects to **MCP servers** for tools/capabilities
- Supports **streaming** responses and intermediate states
- Includes **authentication**, **tracing**, and **evaluations**

## Understanding the Template

The **template agent** (Petstore) serves as the foundation for all new agents. Let's explore its structure:

```
ai_platform_engineering/agents/template/
├── agent_petstore/                    # Main agent package
│   ├── __init__.py
│   ├── __main__.py                   # Entry point
│   ├── agentcard.py                  # Agent metadata
│   └── protocol_bindings/
│       └── a2a_server/
│           ├── agent.py              # LangGraph agent implementation
│           ├── agent_executor.py     # Agent executor factory
│           ├── helpers.py            # Helper functions
│           ├── state.py              # Agent state definition
│           └── README.md
├── mcp/                              # MCP server (optional)
├── evals/                            # Evaluation suites
├── pyproject.toml                    # Dependencies
├── Makefile                          # Build tasks
└── README.md                         # Documentation
```

## Step 1: Clone the Template

Let's create a new agent called "example" that interacts with a fictional Example API.

```bash
# Navigate to agents directory
cd ai_platform_engineering/agents/

# Copy the template
cp -r template/ example/

# Rename the main package
cd example/
mv agent_petstore/ agent_example/
```

## Step 2: Update Package Metadata

### Update `pyproject.toml`

```toml
[project]
name = "agent-example"
version = "0.1.0"
description = "AI Agent for Example API"
authors = [
    {name = "Your Name", email = "your.email@example.com"}
]
requires-python = ">=3.11"
dependencies = [
    "ai-platform-engineering-utils",
    "a2a-sdk>=0.3.0",
    "langchain-core>=1.1.2",
    "langchain-mcp-adapters>=0.1.11",
    "langgraph>=1.0.4",
    "langchain-openai>=1.1.0",
    "langchain-anthropic>=1.1.0",
    "cnoe-agent-utils>=0.3.9",
    "httpx>=0.28.0",
    "pydantic>=2.10.6",
    "python-dotenv>=1.2.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "ruff>=0.9.0",
]

[tool.uv]
dev-dependencies = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
]

[tool.uv.sources]
ai-platform-engineering-utils = { path = "../../utils", editable = true }
mcp-example = { path = "./mcp", editable = true }

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I"]
ignore = ["E501"]
```

### Update Agent Card (`agent_example/agentcard.py`)

```python
"""Agent card for Example agent."""

AGENT_CARD = {
    "name": "example",
    "display_name": "Example Agent",
    "version": "0.1.0",
    "description": "AI agent for interacting with Example API",
    "author": "Your Name",
    "license": "Apache-2.0",
    "capabilities": [
        "Query example data",
        "Create example resources",
        "Update example resources",
        "Delete example resources"
    ],
    "llm_models": [
        "gpt-4o",
        "claude-3-5-sonnet-20241022",
        "gemini-2.0-flash"
    ],
    "mcp_servers": [
        {
            "name": "mcp-example",
            "type": "http",
            "url": "http://mcp-example:8080",
            "description": "MCP server for Example API"
        }
    ],
    "environment_variables": [
        {
            "name": "EXAMPLE_API_KEY",
            "required": True,
            "description": "API key for Example API"
        },
        {
            "name": "EXAMPLE_API_URL",
            "required": False,
            "default": "https://api.example.com",
            "description": "Base URL for Example API"
        }
    ]
}
```

## Step 3: Define Agent State

Update `agent_example/protocol_bindings/a2a_server/state.py`:

```python
"""State definition for Example agent."""

from typing import Annotated, TypedDict
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage


class ExampleAgentState(TypedDict):
    """State for the Example agent.

    Attributes:
        messages: Conversation history between user and agent
        example_context: Additional context specific to Example domain
    """

    messages: Annotated[list[BaseMessage], add_messages]
    example_context: dict
```

## Step 4: Implement the Agent Logic

Update `agent_example/protocol_bindings/a2a_server/agent.py`:

```python
"""LangGraph agent implementation for Example agent."""

import os
from typing import Any
from langchain_core.messages import SystemMessage
from cnoe_agent_utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from .state import ExampleAgentState


# System prompt for the Example agent
SYSTEM_PROMPT = """You are an AI assistant specialized in helping users interact with the Example API.

Your capabilities include:
- Querying example resources
- Creating new example resources
- Updating existing example resources
- Deleting example resources

Always:
- Ask clarifying questions when user intent is unclear
- Provide clear, actionable responses
- Use the MCP tools to interact with the Example API
- Handle errors gracefully and suggest alternatives

Current date and time: {current_datetime}
"""


class ExampleAgent(BaseLangGraphAgent):
    """LangGraph-based Example agent using MCP adapter."""

    def __init__(
        self,
        model_name: str | None = None,
        llm_provider: str | None = None,
        **kwargs: Any
    ) -> None:
        """Initialize the Example agent.

        Args:
            model_name: Name of the LLM model to use
            llm_provider: LLM provider (openai, anthropic, azure-openai)
            **kwargs: Additional arguments passed to BaseLangGraphAgent
        """
        # Get Example API configuration
        self.example_api_url = os.getenv(
            "EXAMPLE_API_URL",
            "https://api.example.com"
        )
        self.example_api_key = os.getenv("EXAMPLE_API_KEY")

        if not self.example_api_key:
            raise ValueError(
                "EXAMPLE_API_KEY environment variable is required"
            )

        super().__init__(
            agent_name="example",
            state_schema=ExampleAgentState,
            system_prompt=SYSTEM_PROMPT,
            model_name=model_name,
            llm_provider=llm_provider,
            **kwargs
        )

    def get_mcp_config(self) -> list[dict[str, Any]]:
        """Configure MCP server connection.

        Returns:
            List of MCP server configurations
        """
        return [
            {
                "name": "example",
                "transport": {
                    "type": "http",
                    "url": "http://mcp-example:8080",
                    "headers": {
                        "X-API-Key": self.example_api_key
                    }
                }
            }
        ]

    def _create_initial_state(
        self,
        messages: list,
        **kwargs: Any
    ) -> dict[str, Any]:
        """Create initial agent state.

        Args:
            messages: Initial messages
            **kwargs: Additional state data

        Returns:
            Initial state dictionary
        """
        return {
            "messages": messages,
            "example_context": kwargs.get("example_context", {})
        }
```

## Step 5: Create Agent Executor

Update `agent_example/protocol_bindings/a2a_server/agent_executor.py`:

```python
"""Agent executor factory for Example agent."""

import logging
from typing import Any
from .agent import ExampleAgent

logger = logging.getLogger(__name__)


def create_example_agent_executor(**kwargs: Any) -> ExampleAgent:
    """Create and configure the Example agent executor.

    Args:
        **kwargs: Configuration parameters for the agent

    Returns:
        Configured ExampleAgent instance
    """
    logger.info("Creating Example agent executor")

    # Extract configuration
    model_name = kwargs.get("model_name")
    llm_provider = kwargs.get("llm_provider")

    # Create agent
    agent = ExampleAgent(
        model_name=model_name,
        llm_provider=llm_provider,
        **kwargs
    )

    logger.info(
        f"Example agent created with model={model_name}, "
        f"provider={llm_provider}"
    )

    return agent
```

## Step 6: Update Entry Points

### Update `agent_example/__main__.py`

```python
"""Entry point for Example agent A2A server."""

import asyncio
import logging
import os
from cnoe_agent_utils.a2a_common.base_a2a_server import BaseA2AServer
from .protocol_bindings.a2a_server.agent_executor import create_example_agent_executor

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def main() -> None:
    """Start the Example agent A2A server."""
    # Get configuration from environment
    model_name = os.getenv("MODEL_NAME", "gpt-4o")
    llm_provider = os.getenv("LLM_PROVIDER", "openai")
    host = os.getenv("AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("AGENT_PORT", "8000"))

    logger.info(
        f"Starting Example agent: model={model_name}, "
        f"provider={llm_provider}, port={port}"
    )

    # Create agent executor
    agent_executor = create_example_agent_executor(
        model_name=model_name,
        llm_provider=llm_provider
    )

    # Create and start A2A server
    server = BaseA2AServer(
        agent_executor=agent_executor,
        host=host,
        port=port
    )

    await server.start()


if __name__ == "__main__":
    asyncio.run(main())
```

## Step 7: Create Makefile

Create `Makefile` in the agent directory:

```makefile
.PHONY: help install test lint run-a2a run-a2a-client clean

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	uv sync --all-groups

test: ## Run tests
	uv run pytest

lint: ## Run linter
	uv run ruff check .

lint-fix: ## Fix linting issues
	uv run ruff check --fix .
	uv run ruff format .

run-a2a: ## Run agent in A2A mode
	uv run python -m agent_example

run-a2a-client: ## Run A2A client
	uvx --no-cache git+https://github.com/cnoe-io/agent-chat-cli.git a2a

clean: ## Clean build artifacts
	rm -rf .venv __pycache__ .pytest_cache .ruff_cache
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
```

## Step 8: Add Docker Support

Create `Dockerfile` (or add to `build/agents/Dockerfile.a2a`):

```dockerfile
# Use in build/agents/Dockerfile.a2a with build arg AGENT_NAME=example
ARG AGENT_NAME
FROM python:3.11-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy workspace files
COPY pyproject.toml uv.lock ./
COPY ai_platform_engineering/ ./ai_platform_engineering/

# Install dependencies
RUN uv sync --frozen --no-dev

# Set agent-specific configuration
ENV AGENT_NAME=${AGENT_NAME}
EXPOSE 8000

# Run the agent
CMD ["uv", "run", "python", "-m", f"agent_{AGENT_NAME}"]
```

## Step 9: Add to Docker Compose

Update `docker-compose.dev.yaml`:

```yaml
services:
  agent-example:
    build:
      context: .
      dockerfile: build/agents/Dockerfile.a2a
      args:
        AGENT_NAME: example
    container_name: agent-example
    environment:
      - AGENT_NAME=example
      - LLM_PROVIDER=${LLM_PROVIDER:-openai}
      - MODEL_NAME=${MODEL_NAME:-gpt-4o}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - EXAMPLE_API_KEY=${EXAMPLE_API_KEY}
      - EXAMPLE_API_URL=${EXAMPLE_API_URL:-https://api.example.com}
      - AGENT_PORT=8000
      - LOG_LEVEL=INFO
    ports:
      - "8005:8000"
    volumes:
      - ./ai_platform_engineering:/app/ai_platform_engineering
    networks:
      - ai-platform-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  ai-platform-network:
    driver: bridge
```

## Step 10: Create Tests

Create `tests/test_example_agent.py`:

```python
"""Tests for Example agent."""

import pytest
from agent_example.protocol_bindings.a2a_server.agent import ExampleAgent
from langchain_core.messages import HumanMessage


@pytest.fixture
def example_agent():
    """Create Example agent instance for testing."""
    return ExampleAgent(
        model_name="gpt-4o-mini",
        llm_provider="openai"
    )


@pytest.mark.asyncio
async def test_agent_initialization(example_agent):
    """Test agent initializes correctly."""
    assert example_agent.agent_name == "example"
    assert example_agent.example_api_key is not None


@pytest.mark.asyncio
async def test_agent_response(example_agent):
    """Test agent can process messages."""
    messages = [HumanMessage(content="Hello, what can you do?")]

    response = await example_agent.ainvoke({"messages": messages})

    assert "messages" in response
    assert len(response["messages"]) > 1
```

## Step 11: Create Documentation

Create `README.md`:

```markdown
# Example Agent

AI agent for interacting with Example API using LangGraph and MCP.

## Features

- Query example resources
- Create, update, and delete resources
- Streaming responses
- A2A protocol support
- OpenTelemetry tracing

## Quick Start

### Using Docker

\`\`\`bash
docker compose up agent-example
\`\`\`

### Local Development

\`\`\`bash
# Install dependencies
make install

# Run the agent
make run-a2a

# In another terminal, connect a client
make run-a2a-client
\`\`\`

## Configuration

Required environment variables:

- `EXAMPLE_API_KEY`: API key for Example API
- `LLM_PROVIDER`: openai, anthropic, or azure-openai
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`

Optional:

- `EXAMPLE_API_URL`: Base URL (default: https://api.example.com)
- `MODEL_NAME`: LLM model to use
- `AGENT_PORT`: Port to listen on (default: 8000)

## Example Interactions

\`\`\`
User: What resources are available?
Agent: Let me check the available resources...

User: Create a new resource with name "test"
Agent: I'll create that resource for you...
\`\`\`

## Development

\`\`\`bash
# Run tests
make test

# Run linter
make lint

# Auto-fix linting
make lint-fix
\`\`\`

## License

Apache 2.0
```

## Step 12: Test Your Agent

```bash
# Install dependencies
cd ai_platform_engineering/agents/example
make install

# Run tests
make test

# Start the agent
make run-a2a

# In another terminal, test with the client
make run-a2a-client
```

## Step 13: Commit Your Changes

```bash
# Stage your changes
git add ai_platform_engineering/agents/example/

# Commit with DCO sign-off
git commit -s -m "feat(agent): add Example agent

Created new Example agent with:
- LangGraph implementation
- MCP integration
- A2A protocol support
- Tests and documentation"

# Push to your fork
git push origin feat/add-example-agent
```

## Best Practices

### Agent Design

1. **Single Responsibility**: Each agent should focus on one domain/API
2. **Clear Instructions**: Write detailed system prompts
3. **Error Handling**: Handle API errors gracefully
4. **Validation**: Validate user inputs before calling tools
5. **Streaming**: Support streaming for better UX

### System Prompts

- Be specific about capabilities
- Include examples of successful interactions
- Define clear boundaries (what the agent can't do)
- Use few-shot examples for complex tasks
- Include current date/time when relevant

### Testing

- Unit tests for agent logic
- Integration tests with MCP server
- Evaluation suites for quality assurance
- Test with multiple LLM models
- Test error cases and edge conditions

### Documentation

- Clear README with quickstart
- Environment variable documentation
- Example interactions
- Architecture diagrams
- Contribution guidelines

## Advanced Topics

### Adding Memory

```python
from langchain_core.chat_history import InMemoryChatMessageHistory

class ExampleAgent(BaseLangGraphAgent):
    def __init__(self, **kwargs):
        self.memory = InMemoryChatMessageHistory()
        super().__init__(**kwargs)
```

### Adding RAG

```python
from cnoe_agent_utils.rag import RAGRetriever

class ExampleAgent(BaseLangGraphAgent):
    def __init__(self, **kwargs):
        self.retriever = RAGRetriever(collection="example-docs")
        super().__init__(**kwargs)
```

### Adding Authentication

```python
def get_mcp_config(self) -> list[dict[str, Any]]:
    return [{
        "name": "example",
        "transport": {
            "type": "http",
            "url": "http://mcp-example:8080",
            "headers": {
                "Authorization": f"Bearer {self.api_token}"
            }
        }
    }]
```

## Next Steps

- **[Create an MCP Server](./creating-mcp-server)** - Build the tools for your agent
- **[Add Evaluations](../evaluations/index.md)** - Test agent quality
- **[Deploy to Production](../installation/index.md)** - Deploy with Helm/Kubernetes

## Troubleshooting

### Agent won't start

- Check `.env` file has all required variables
- Verify API keys are valid
- Check MCP server is running
- Review logs for errors

### MCP connection fails

- Verify MCP server URL is correct
- Check network connectivity
- Ensure authentication headers are correct
- Test MCP server independently

### Tests failing

- Run with verbose output: `pytest -v`
- Check test environment variables
- Verify test fixtures are correct
- Use `pytest --pdb` for debugging

---

**You've created your first agent!** 🎉

Share your agent with the community:
- Create a PR to add it to the platform
- Write a blog post about your use case
- Present at a CNOE community meeting

