# GitHub MCP Server Makefile
# --------------------------------------------------
# The GitHub agent uses the external official MCP image
# (ghcr.io/github/github-mcp-server) — there is no local MCP server or
# Python package in this directory. This Makefile is self-contained (it does
# not include ../mcp-common.mk) because there is nothing to build or run
# locally.
# --------------------------------------------------

AGENT_NAME = github

.DEFAULT_GOAL := help

.PHONY: help run run-mcp test

help: ## Show this help message
	@echo "GitHub MCP server ($(AGENT_NAME)) — external image, no local targets."
	@echo ""
	@grep -h -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

run run-mcp: ## GitHub uses the external ghcr.io/github/github-mcp-server image
	@echo "The GitHub agent has no local MCP server."
	@echo "It runs as the external image ghcr.io/github/github-mcp-server."
	@echo "See README.md for usage."
	@exit 1

test: ## No local tests (external image)
	@echo "No local tests for the GitHub agent (external image)."
