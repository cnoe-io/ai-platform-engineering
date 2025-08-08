# Komodor Agent Makefile
# --------------------------------------------------
# This Makefile includes common functionality and adds Komodor-specific targets.
# --------------------------------------------------

# Agent-specific variables
AGENT_NAME = komodor

# Include common functionality
include ../common.mk

# Additional PHONY targets specific to this agent
.PHONY: komodor-specific-target

## ========== Komodor-Specific Targets ==========

komodor-specific-target: ## Example komodor-specific target
	@echo "This is a Komodor-specific target"
	@echo "Agent: $(AGENT_NAME)"
	@echo "Package: $(AGENT_PKG_NAME)"

# Override run-a2a to use ARGOCD_A2A_PORT instead of A2A_AGENT_PORT
run-a2a: setup-venv check-env uv-sync ## Run A2A agent with uvicorn (Komodor-specific port)
	@A2A_PORT=$$(grep ARGOCD_A2A_PORT .env | cut -d '=' -f2); \
	uv run python -m $(AGENT_PKG_NAME) --host 0.0.0.0 --port $${A2A_PORT:-8000}

