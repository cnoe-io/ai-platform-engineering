# VictorOps MCP Server Makefile
# --------------------------------------------------
# This Makefile provides targets for the VictorOps MCP server.
# It includes common functionality from ../../mcp-common.mk
# --------------------------------------------------

# MCP configuration
AGENT_NAME = victorops
MCP_PACKAGE_NAME = mcp_victorops

# Include common functionality
include ../../mcp-common.mk

# Agent-specific MCP targets can be added here if needed

# Test targets
.PHONY: test test-verbose

test: setup-uv uv-venv ## Run all tests
	@echo "Running VictorOps MCP tests..."
	@uv sync --all-groups
	@export VICTOROPS_API_URL="https://localhost:8080" && \
	export X_VO_API_KEY="dummy-key-for-testing" && \
	export X_VO_API_ID="dummy-id-for-testing" && \
	cd tests && \
	uv run python run_all_tests.py

test-verbose: setup-uv uv-venv ## Run all tests with verbose output
	@echo "Running VictorOps MCP tests with verbose output..."
	@uv sync --all-groups
	@export VICTOROPS_API_URL="https://localhost:8080" && \
	export X_VO_API_KEY="dummy-key-for-testing" && \
	export X_VO_API_ID="dummy-id-for-testing" && \
	cd tests && \
	uv run python -v run_all_tests.py
