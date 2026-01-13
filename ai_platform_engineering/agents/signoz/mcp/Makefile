# SigNoz MCP Server Makefile
# --------------------------------------------------
# This Makefile provides targets for the SigNoz MCP server.
# It includes common functionality from ../../mcp-common.mk
# --------------------------------------------------

# MCP configuration
AGENT_NAME = signoz
MCP_PACKAGE_NAME = mcp_signoz

# Include common functionality
include ../../mcp-common.mk

# Agent-specific MCP targets can be added here if needed

# Test targets
.PHONY: test test-verbose

test: setup-uv uv-venv ## Run all tests
	@echo "Running SigNoz MCP tests..."
	@uv sync --all-groups
	@export SIGNOZ_API_URL="http://localhost:3301" && \
	cd tests && \
	uv run python run_all_tests.py

test-verbose: setup-uv uv-venv ## Run all tests with verbose output
	@echo "Running SigNoz MCP tests with verbose output..."
	@uv sync --all-groups
	@export SIGNOZ_API_URL="http://localhost:3301" && \
	cd tests && \
	uv run python -v run_all_tests.py
