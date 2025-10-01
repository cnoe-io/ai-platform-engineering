# Kubernetes Agent Makefile
# --------------------------------------------------
# This Makefile provides targets for the Kubernetes agent.
# It includes common functionality from ../common.mk
# --------------------------------------------------

# Agent configuration
AGENT_NAME = kubernetes

# Include common functionality
include ../common.mk

run-a2a: setup-venv check-env uv-sync ## Run A2A agent with uvicorn
	uv run python -m $(AGENT_PKG_NAME) --host 0.0.0.0 --port $${A2A_PORT:-8000}
