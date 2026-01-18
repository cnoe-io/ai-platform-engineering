# Kubernetes Agent Makefile
# --------------------------------------------------
# This Makefile provides targets for the Kubernetes agent.
# It includes common functionality from ../common.mk
# --------------------------------------------------

# Agent configuration
AGENT_NAME = kubernetes

# Include common functionality
include ../common.mk

# Override test target - agent tests depend on workspace context
.PHONY: test
test: ## Run Kubernetes tests (use workspace-level targets)
	@echo "❌ Kubernetes agent tests depend on ai_platform_engineering workspace utilities."
	@echo ""
	@echo "Run tests from the workspace root instead:"
	@echo "  make test-mcp-kubernetes    # Run MCP server tests only"
	@echo "  make test                    # Run all tests"
	@echo ""
	@echo "Or run from workspace root with pytest:"
	@echo "  cd ../../.. && pytest ai_platform_engineering/agents/kubernetes/tests/"
	@exit 1
