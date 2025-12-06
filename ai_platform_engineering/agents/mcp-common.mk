# Common Makefile for CNOE Agent MCP Servers
# --------------------------------------------------
# This file provides common targets for MCP server components.
# Include this file in your MCP server's Makefile to get all common functionality.
#
# Required variables to be set in your MCP server's Makefile:
#   AGENT_NAME - The name of your agent (e.g., slack, github, komodor)
#   MCP_PACKAGE_NAME - The name of the MCP package (e.g., mcp_slack)
#
# Optional variables:
#   MCP_MODE - The mode to run MCP in (STDIO or HTTP, default: STDIO)
#   MCP_HOST - The host for HTTP mode (default: localhost)
#   MCP_PORT - The port for HTTP mode (default: 8000)
# --------------------------------------------------

# Ensure required variables are set
ifndef AGENT_NAME
$(error AGENT_NAME must be set before including mcp-common.mk)
endif

ifndef MCP_PACKAGE_NAME
$(error MCP_PACKAGE_NAME must be set before including mcp-common.mk)
endif

# Default variables
MCP_MODE ?= STDIO
MCP_HOST ?= localhost
MCP_PORT ?= 8000

## -------------------------------------------------
.PHONY: help setup-uv uv-venv uv-sync copy-env verify-env run test

## ========== Help ==========

help: ## Show this help message
	@echo "Available targets for $(AGENT_NAME) MCP server:"
	@echo "Variables:"
	@echo "  AGENT_NAME=$(AGENT_NAME)"
	@echo "  MCP_PACKAGE_NAME=$(MCP_PACKAGE_NAME)"
	@echo "  MCP_MODE=$(MCP_MODE)"
	@echo "  MCP_HOST=$(MCP_HOST)"
	@echo "  MCP_PORT=$(MCP_PORT)"
	@echo ""
	@echo "Targets:"
	@grep -h -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

## ========== Setup ==========

setup-uv: ## Install UV package manager
	@if ! which uv > /dev/null; then \
		echo "UV is not installed. Installing UV..."; \
		curl -LsSf https://astral.sh/uv/install.sh | sh; \
	else \
		echo "UV is already installed."; \
	fi

uv-venv: setup-uv ## Create and activate a virtual environment
	@if [ ! -d ".venv" ]; then \
		uv venv && echo "Virtual environment created."; \
	else \
		echo "Virtual environment already exists."; \
	fi
	@. .venv/bin/activate

uv-sync: setup-uv uv-venv ## Sync UV dependencies
	uv sync

## ========== Environment ==========

copy-env: ## Copy .env.example to .env if it exists
	@if [ -f ".env.example" ]; then \
		cp .env.example .env && echo ".env file created from .env.example"; \
	else \
		echo "No .env.example file found, skipping .env creation"; \
	fi

verify-env: ## Verify .env file has required variables
	@echo "Verifying .env.mcp file in current directory: $$(pwd)..."
	@if [ ! -f "./.env.mcp" ]; then \
		echo ".env.mcp file not found in current directory ($$(pwd)). Please create it."; \
		exit 1; \
	fi
	@echo ".env.mcp file exists and ready in $$(pwd)"

setup-env: verify-env ## Setup environment files

## ========== Run ==========

.DEFAULT_GOAL := run

run: uv-sync setup-env ## Run the MCP server
	@echo "Starting $(AGENT_NAME) MCP server..."
	@echo "Mode: $(MCP_MODE)"
	@if [ "$(MCP_MODE)" = "HTTP" ]; then \
		echo "Host: $(MCP_HOST)"; \
		echo "Port: $(MCP_PORT)"; \
	fi
	@set -a; \
	if [ -f .env ]; then . "$$(pwd)/.env"; fi; \
	if [ -f .env.mcp ]; then . "$$(pwd)/.env.mcp"; fi; \
	set +a && \
	MCP_MODE=$(MCP_MODE) MCP_HOST=$(MCP_HOST) MCP_PORT=$(MCP_PORT) \
	uv run python $(MCP_PACKAGE_NAME)/server.py

## ========== Test ==========

test: setup-uv ## Run tests for the MCP server
	@echo "Running $(AGENT_NAME) MCP tests..."
	@if [ -d "tests" ]; then \
		uv sync --all-groups && \
		uv run pytest tests/ -v --tb=short; \
	else \
		echo "No tests directory found for $(AGENT_NAME) MCP server"; \
	fi
