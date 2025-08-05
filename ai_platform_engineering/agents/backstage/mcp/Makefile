.PHONY: help setup-uv uv-venv uv-sync copy-env setup-env run

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

setup-uv: ## Install UV
	@if ! which uv > /dev/null; then \
		echo "UV is not installed. Installing UV..."; \
		curl -LsSf https://astral.sh/uv/install.sh | sh; \
	else \
		echo "UV is already installed."; \
	fi

uv-venv: ## Create and activate a virtual environment
	uv venv && . .venv/bin/activate

uv-sync: setup-uv uv-venv ## Sync UV dependencies
	uv sync

copy-env: ## Copy .env.example to .env
	cp .env.example .env

verify-env: ## Setup .env file with required variables
	@echo "Verifying .env file..."
	@if [ ! -f .env ]; then \
		echo ".env file not found. Please create it."; \
		exit 1; \
	fi
	@missing_vars=$$(grep -E '^(BACKSTAGE_API_TOKEN|BACKSTAGE_URL|MCP_MODE|MCP_HOST|MCP_PORT)=' .env | awk -F= 'NF<2 {print $$1}'); \
	if [ -n "$$missing_vars" ]; then \
		echo "The following required variables are missing in .env:"; \
		echo "$$missing_vars"; \
		exit 1; \
	fi

.DEFAULT_GOAL := run

run: uv-sync ## Run the MCP Backstage server
	set -a; source .env; set +a && uv run python mcp_backstage/server.py