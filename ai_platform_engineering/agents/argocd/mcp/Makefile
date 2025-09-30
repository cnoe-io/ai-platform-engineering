# ArgoCD MCP Server Makefile
# --------------------------------------------------
# This Makefile provides targets for the ArgoCD MCP server.
# It includes common functionality from ../../mcp-common.mk
# --------------------------------------------------

# MCP configuration
AGENT_NAME = argocd
MCP_PACKAGE_NAME = mcp_argocd

# Include common functionality
include ../../mcp-common.mk

# Agent-specific MCP targets can be added here if needed

# Test targets
.PHONY: test test-verbose

test: ## Run all tests
	@echo "Running ArgoCD MCP tests..."
	@cd tests && \
	export ARGOCD_API_URL="https://localhost:8080" && \
	export ARGOCD_API_TOKEN="dummy-token-for-testing" && \
	python run_all_tests.py

test-verbose: ## Run all tests with verbose output
	@echo "Running ArgoCD MCP tests with verbose output..."
	@cd tests && \
	export ARGOCD_API_URL="https://localhost:8080" && \
	export ARGOCD_API_TOKEN="dummy-token-for-testing" && \
	python -v run_all_tests.py