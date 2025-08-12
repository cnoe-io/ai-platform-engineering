# CNOE Agent Makefile System

This directory contains a common Makefile system that simplifies and standardizes the build process across all CNOE agents.

## Files

- `common.mk` - Common Makefile with shared functionality for all agents
- `mcp-common.mk` - Common Makefile for MCP server components

## Usage

### For Main Agent Makefiles

Replace your existing verbose Makefile with a simple one that includes the common functionality:

```makefile
# Your Agent Makefile
# Agent-specific variables
AGENT_NAME = your_agent_name

# Include common functionality
include ../common.mk

# Add any agent-specific targets here
your-specific-target: ## Your specific target
	@echo "Agent-specific functionality"
```

### For MCP Server Makefiles

For MCP server subdirectories:

```makefile
# Your MCP Server Makefile
# MCP-specific variables
AGENT_NAME = your_agent_name
MCP_PACKAGE_NAME = mcp_your_agent_name

# Override defaults if needed
MCP_MODE = SSE
MCP_HOST = localhost
MCP_PORT = 8000

# Include common MCP functionality
include ../../mcp-common.mk

# Add any MCP-specific targets here
```

## Configuration Variables

### For Main Agents

- `AGENT_NAME` (required) - The name of your agent (e.g., slack, github, komodor)
- `AGENT_DIR_NAME` (optional) - Defaults to `agent-$(AGENT_NAME)`
- `AGENT_PKG_NAME` (optional) - Defaults to `agent_$(AGENT_NAME)`
- `MCP_SERVER_DIR` (optional) - Defaults to `mcp_$(AGENT_NAME)`

### For MCP Servers

- `AGENT_NAME` (required) - The name of your agent
- `MCP_PACKAGE_NAME` (required) - The name of the MCP package
- `MCP_MODE` (optional, default: STDIO) - The mode to run MCP in
- `MCP_HOST` (optional, default: localhost) - The host for HTTP mode
- `MCP_PORT` (optional, default: 8000) - The port for HTTP mode

## Available Targets

### Common Targets (available in all agent Makefiles)

**Setup & Clean:**
- `setup-venv` - Create Python virtual environment
- `clean` - Clean all build artifacts and cache
- `clean-pyc` - Remove Python bytecode
- `clean-venv` - Remove virtual environment
- `clean-build-artifacts` - Remove dist/, build/, egg-info/

**Environment:**
- `check-env` - Check if .env file exists
- `copy-env-from-root` - Copy .env from root directory
- `uv-sync` - Install dependencies with UV
- `uv-install` - Install UV package manager

**Build & Lint:**
- `build` - Build the package
- `lint` / `ruff` - Lint code with ruff
- `ruff-fix` - Auto-fix lint issues

**Run:**
- `run` - Run the agent (defaults to A2A)
- `run-a2a` - Run A2A agent
- `run-mcp` - Run MCP server

**Clients:**
- `run-a2a-client` - Run A2A client
- `run-mcp-client` - Run MCP client
- `langgraph-dev` - Run LangGraph dev mode
- `evals` - Run agent evaluations

**Docker:**
- `build-docker-a2a` - Build A2A Docker image
- `build-docker-a2a-tag` - Tag A2A Docker image
- `build-docker-a2a-push` - Push A2A Docker image
- `build-docker-a2a-tag-and-push` - Tag and push A2A Docker image
- `run-docker-a2a` - Run A2A agent in Docker

**Other:**
- `test` - Run tests with pytest and coverage
- `registry-agntcy-directory` - Push to AGNTCY registry
- `add-copyright-license-headers` - Add license headers
- `help` - Show available targets

### MCP Targets (available in MCP server Makefiles)

- `setup-uv` - Install UV package manager
- `uv-venv` - Create virtual environment
- `uv-sync` - Sync dependencies
- `copy-env` - Copy .env.example to .env
- `verify-env` - Verify .env file
- `setup-env` - Setup environment files
- `run` - Run MCP server
- `help` - Show available targets

## Examples

### Slack Agent
```makefile
AGENT_NAME = slack
include ../common.mk
```

### GitHub Agent
```makefile
AGENT_NAME = github
include ../common.mk
```

### Komodor Agent
```makefile
AGENT_NAME = komodor
include ../common.mk
```

### Slack MCP Server
```makefile
AGENT_NAME = slack
MCP_PACKAGE_NAME = mcp_slack
MCP_MODE = SSE
include ../../mcp-common.mk
```

## Migration Guide

To migrate an existing agent to use the common system:

1. **Backup your current Makefile:**
   ```bash
   cp Makefile Makefile.backup
   ```

2. **Create a new simplified Makefile** using the template:
   ```bash
   cp template/Makefile ../your_agent/Makefile
   ```

3. **Update the AGENT_NAME** in your new Makefile

4. **Add any agent-specific targets** that were in your original Makefile

5. **Test the new Makefile:**
   ```bash
   make help
   make setup-venv
   make run-a2a
   ```

6. **For MCP servers**, follow the same process but use the MCP template

## Benefits

- **Consistency:** All agents use the same targets and patterns
- **Maintainability:** Common functionality is centralized
- **Simplicity:** Agent-specific Makefiles are much shorter and clearer
- **Flexibility:** Easy to customize per agent while maintaining common functionality
- **Documentation:** Built-in help system shows all available targets
- **Standardization:** UV-based workflow across all agents
