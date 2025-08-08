# Slack MCP Server Makefile
# --------------------------------------------------
# This Makefile includes common MCP functionality.
# --------------------------------------------------

# MCP-specific variables
AGENT_NAME = slack
MCP_PACKAGE_NAME = mcp_slack

# Override defaults if needed (optional)
# MCP_MODE = HTTP  # Uncomment to use HTTP mode instead of default STDIO
# MCP_HOST = localhost
# MCP_PORT = 8000

# Include common MCP functionality
include ../../mcp-common.mk

# Additional PHONY targets specific to this MCP server
.PHONY: slack-mcp-specific

## ========== Slack MCP-Specific Targets ==========

slack-mcp-specific: ## Example slack MCP-specific target
	@echo "This is a Slack MCP-specific target"
	@echo "MCP Package: $(MCP_PACKAGE_NAME)"