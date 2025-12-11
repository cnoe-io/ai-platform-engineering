# ArgoCD Agent Makefile
# --------------------------------------------------
# This Makefile provides targets for the ArgoCD agent.
# It includes common functionality from ../common.mk
# --------------------------------------------------

# Agent configuration
AGENT_NAME = argocd

# Include common functionality
include ../common.mk

# Override test target - agent tests depend on workspace context
.PHONY: test
test: ## Run ArgoCD tests (use workspace-level targets)
	@echo "❌ ArgoCD agent tests depend on ai_platform_engineering workspace utilities."
	@echo ""
	@echo "Run tests from the workspace root instead:"
	@echo "  make test-mcp-argocd    # Run MCP server tests only"
	@echo "  make test               # Run all tests"
	@echo ""
	@echo "Or run from workspace root with pytest:"
	@echo "  cd ../../.. && pytest ai_platform_engineering/agents/argocd/tests/"
	@exit 1