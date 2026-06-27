# AI Platform Engineering Common Utilities

This package contains common utilities shared across AI Platform Engineering services.

## Modules

### `agui/` - AG-UI Event Helpers

Common event types, emitters, and encoders for AG-UI streaming responses.

### `auth/` - Runtime Auth Helpers

Shared Keycloak, JWKS, audit, and token-context helpers for CAIPE runtimes and
MCP integrations.

### `prompt_templates.py` - Common Prompt Templates

Reusable prompt templates and building blocks for creating consistent system instructions across agents. See [PROMPT_TEMPLATES_README.md](PROMPT_TEMPLATES_README.md) for details.

**Key Features:**
- Graceful error handling templates for all services
- Response format templates (XML coordination, simple status)
- System instruction builder with structured capabilities
- Pre-defined guidelines and important notes
- Utility functions for combining prompt components

## Installation

This package is designed to be used as a local dependency within the AI Platform Engineering monorepo:

```toml
[tool.uv.sources]
ai-platform-engineering-common = { path = "../../common" }
```

## License

Apache-2.0
