# Istio MCP Server Makefile
# --------------------------------------------------
# This Makefile provides targets for the Istio MCP server.
# It includes common functionality from ../../mcp-common.mk
# --------------------------------------------------

# MCP configuration
AGENT_NAME = istio
MCP_PACKAGE_NAME = mcp_istio

# Include common functionality
include ../../mcp-common.mk

# Agent-specific MCP targets can be added here if needed

# Test targets
.PHONY: test test-verbose

test: setup-uv uv-venv ## Run all tests
	@echo "Running Istio MCP tests..."
	@uv sync --all-groups
	@cd tests && \
	uv run python run_all_tests.py

test-verbose: setup-uv uv-venv ## Run all tests with verbose output
	@echo "Running Istio MCP tests with verbose output..."
	@uv sync --all-groups
	@cd tests && \
	uv run python -v run_all_tests.py
