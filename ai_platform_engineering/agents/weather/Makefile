# Weather Agent Makefile
# --------------------------------------------------
# This Makefile provides targets for the Weather agent.
# It includes common functionality from ../common.mk
# --------------------------------------------------

# Agent configuration
AGENT_NAME = weather

# Include common functionality
include ../common.mk

# Override run-a2a target to skip MCP dependency since this agent doesn't have MCP
run-a2a: setup-venv check-env uv-sync ## Run A2A agent with uvicorn (weather agent override)
	uv run python -m $(AGENT_PKG_NAME) --host 0.0.0.0 --port $${A2A_PORT:-8000}

