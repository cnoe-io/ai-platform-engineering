# AI Platform Engineering Common Utilities

This package contains common utilities and base classes shared across all AI Platform Engineering agents.

## Modules

### `a2a/` - Agent-to-Agent Protocol

Common A2A (Agent-to-Agent) protocol bindings with streaming support. See [a2a/README.md](a2a/README.md) for details.

**Key Features:**
- `BaseLangGraphAgent` - Abstract base class for agents with streaming support
- `BaseLangGraphAgentExecutor` - Abstract base class for A2A protocol handling
- Common state definitions and helper functions
- Built-in tracing and LLM integration

## Installation

This package is designed to be used as a local dependency within the AI Platform Engineering monorepo:

```toml
[tool.uv.sources]
ai-platform-engineering-common = { path = "../../common" }
```

## Usage

See the [a2a/README.md](a2a/README.md) for detailed usage examples.

## License

Apache-2.0
