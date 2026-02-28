# Netutils Agent Makefile
# --------------------------------------------------
# This Makefile provides targets for the Netutils agent.
# It includes common functionality from ../common.mk
# --------------------------------------------------

# Agent configuration
AGENT_NAME = netutils

# Include common functionality
include ../common.mk

# Override test target - agent tests depend on workspace context
.PHONY: test
test: ## Run Netutils tests (use workspace-level targets)
	@echo "❌ Netutils agent tests depend on ai_platform_engineering workspace utilities."
	@echo ""
	@echo "Run tests from the workspace root instead:"
	@echo "  make test-mcp-netutils    # Run MCP server tests only"
	@echo "  make test                        # Run all tests"
	@echo ""
	@echo "Or run from workspace root with pytest:"
	@echo "  cd ../../.. && pytest ai_platform_engineering/agents/netutils/tests/"
	@exit 1
