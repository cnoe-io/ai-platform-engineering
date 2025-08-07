# Common Makefile for CNOE Agent Projects
# --------------------------------------------------
# This Makefile provides common targets for building, testing, and running CNOE agents.
# Usage:
#   make <target>
# --------------------------------------------------

# Variables
AGENT_NAME ?= slack
AGENT_DIR_NAME = agent-$(shell echo $(AGENT_NAME))
AGENT_PKG_NAME ?= agent_$(shell echo $(AGENT_NAME))
MCP_SERVER_DIR ?= mcp_$(AGENT_NAME)

## -------------------------------------------------
.PHONY: \
	build setup-venv uv-install  uv-sync \
	run run-a2a run-a2a-client \
  build-docker-a2a build-docker-a2a-tag build-docker-a2a-push build-docker-a2a-tag-and-push \
  run-docker-a2a \
	run-mcp run-mcp-client \
	langgraph-dev evals test \
	clean clean-pyc clean-venv clean-build-artifacts \
  check-env lint ruff-fix \
	registry-agntcy-directory release \
	add-copyright-license-headers help

## ========== Setup & Clean ==========

setup-venv:        ## Create the Python virtual environment using uv
	@echo "Setting up virtual environment with uv..."
	@if [ ! -d ".venv" ]; then \
		uv venv .venv && echo "Virtual environment created."; \
	else \
		echo "Virtual environment already exists."; \
	fi
	@echo "To activate manually, run: source .venv/bin/activate"
	@. .venv/bin/activate

clean-pyc:         ## Remove Python bytecode and __pycache__
	@find . -type d -name "__pycache__" -exec rm -rf {} + || echo "No __pycache__ directories found."

clean-venv:        ## Remove the virtual environment
	@rm -rf .venv && echo "Virtual environment removed." || echo "No virtual environment found."

clean-build-artifacts: ## Remove dist/, build/, egg-info/
	@rm -rf dist $(AGENT_PKG_NAME).egg-info || echo "No build artifacts found."

clean:             ## Clean all build artifacts and cache
	@$(MAKE) clean-pyc
	@$(MAKE) clean-venv
	@$(MAKE) clean-build-artifacts
	@find . -type d -name ".pytest_cache" -exec rm -rf {} + || echo "No .pytest_cache directories found."

## ========== Environment Helpers ==========

check-env:         ## Check if .env file exists
	@if [ ! -f ".env" ]; then \
		echo "Warning: .env file not found in $$(pwd)"; \
	fi
	@if [ ! -f ".env" ]; then \
		$(MAKE) copy-env-from-root; \
	fi

copy-env-from-root: ## Copy .env file from root directory
	@echo "Root directory: $(shell git rev-parse --show-toplevel)"
	@if [ -f "../../../.env" ]; then \
		cp ../../../.env . && echo ".env file copied from root directory."; \
	else \
		echo "Error: .env file not found in root directory."; exit 1; \
	fi

## ========== UV Sync ==========

uv-sync: setup-venv ## Sync Python dependencies using uv
	@echo "Installing dependencies..."
	@uv sync --no-dev
	@echo "Dependencies installed successfully."

uv-install:        ## Install uv package manager
	@if ! command -v uv &> /dev/null; then \
		read -p "uv is not installed. Do you want to install it? (y/n): " confirm; \
		if [ "$$confirm" = "y" ]; then \
			curl -LsSf https://astral.sh/uv/install.sh | sh; \
		else \
			echo "uv installation skipped."; \
			exit 1; \
		fi; \
	else \
		echo "uv is already installed."; \
	fi

## ========== Build & Lint ==========
lint: setup-venv     ## Lint code with ruff
	@uv add ruff --dev
	@uv run python -m ruff check $(AGENT_PKG_NAME) tests --select E,F --ignore F403 --ignore E402 --line-length 320

ruff: lint				   ## Run ruff linter

ruff-fix: setup-venv ## Auto-fix lint issues with ruff
	@uv add ruff --dev
	@uv run python -m ruff check $(AGENT_PKG_NAME) tests --fix

## ========== Run ==========

run: run-a2a ## Run the agent application

run-a2a: setup-venv check-env uv-sync ## Run A2A agent with uvicorn
	@A2A_PORT=$$(grep ARGOCD_A2A_PORT .env | cut -d '=' -f2); \
	uv run python -m $(AGENT_PKG_NAME) --host 0.0.0.0 --port $${A2A_PORT:-8000}

run-mcp: setup-venv ## Run MCP server in SSE mode
	@$(MAKE) check-env
	@$(venv-run) MCP_MODE=HTTP uv run $(AGENT_PKG_NAME)/mcp/$(MCP_SERVER_DIR)/server.py

## ========== Clients ==========

run-a2a-client: setup-venv check-env ## Run A2A client script
	@uvx https://github.com/cnoe-io/agent-chat-cli.git a2a

run-mcp-client:  ## Run MCP client script
	@npx @modelcontextprotocol/inspector

## ========== LangGraph Development ==========
langgraph-dev: setup-venv ## Run LangGraph dev mode
	@$(venv-run) uv add langgraph-cli[inmem] --dev
	@$(venv-run) uv sync --dev
	@$(venv-run) langgraph dev

## ========== Evals ==========
evals: setup-venv ## Run agentevals with test cases
	@$(venv-run) uv add agentevals tabulate pytest
	@$(venv-run) uv run evals/strict_match/eval_strict_match.py

## ========== Docker ==========

build-docker-a2a:            ## Build A2A Docker image
	docker build -t $(AGENT_DIR_NAME):a2a-latest -f build/Dockerfile.a2a .

build-docker-a2a-tag:        ## Tag A2A Docker image
	docker tag $(AGENT_DIR_NAME):a2a-latest ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest

build-docker-a2a-push:       ## Push A2A Docker image
	docker push ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest

build-docker-a2a-tag-and-push: ## Tag and push A2A Docker image
	@$(MAKE) build-docker-a2a build-docker-a2a-tag build-docker-a2a-push

run-docker-a2a: install-a2a ## Run the A2A agent in Docker
	@$(MAKE) check-env
	@AGENT_ID=$$(grep CNOE_AGENT_$$(echo $(AGENT_NAME) | tr a-z A-Z)_ID .env | cut -d '=' -f2 | tr -d '"'); \
	AGENT_PORT=$$(grep A2A_AGENT_PORT .env | cut -d '=' -f2 | tr -d '"'); \
	A2A_AGENT_IMAGE=$$(grep A2A_AGENT_IMAGE .env | cut -d '=' -f2 || echo ""); \
	AZURE_OPENAI_ENDPOINT=$$(grep AZURE_OPENAI_ENDPOINT .env | cut -d '=' -f2 | tr -d '"'); \
	AZURE_OPENAI_DEPLOYMENT=$$(grep AZURE_OPENAI_DEPLOYMENT .env | cut -d '=' -f2 | tr -d '"'); \
	AZURE_OPENAI_API_KEY=$$(grep AZURE_OPENAI_API_KEY .env | cut -d '=' -f2 | tr -d '"'); \
	AZURE_OPENAI_API_VERSION=$$(grep AZURE_OPENAI_API_VERSION .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_BOT_TOKEN=$$(grep SLACK_BOT_TOKEN .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_APP_TOKEN=$$(grep SLACK_APP_TOKEN .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_SIGNING_SECRET=$$(grep SLACK_SIGNING_SECRET .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_CLIENT_SECRET=$$(grep SLACK_CLIENT_SECRET .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_TEAM_ID=$$(grep SLACK_TEAM_ID .env | cut -d '=' -f2 | tr -d '"'); \
	LOCAL_AGENT_PORT=$${AGENT_PORT:-8000}; \
	LOCAL_AGENT_IMAGE=$${A2A_AGENT_IMAGE:-ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest}; \
	echo "========================================================================"; \
	echo "==                     A2A AGENT DOCKER RUN                           =="; \
	echo "========================================================================"; \
	echo "Using Agent Image : $$LOCAL_AGENT_IMAGE"; \
	echo "Using Agent ID    : $$AGENT_ID"; \
	echo "Using Agent Port  : localhost:$$LOCAL_AGENT_PORT"; \
	echo "========================================================================"; \
	echo "==               Do not use uvicorn port in the logs                  =="; \
	echo "========================================================================"; \
	docker run -p $$LOCAL_AGENT_PORT:8000 -it \
		-v $(PWD)/.env:/opt/agent_src/.env \
		-v $(PWD)/a2a-python:/opt/agent_src/a2a-python \
		--env-file .env \
		-e AGENT_ID=$$AGENT_ID \
		-e AIOHTTP_CLIENT_MAX_REDIRECTS=10 \
		-e AIOHTTP_CLIENT_TIMEOUT=60 \
		-e API_HOST=0.0.0.0 \
		-e API_URL="http://localhost:$$LOCAL_AGENT_PORT" \
		-e AZURE_OPENAI_ENDPOINT="$$AZURE_OPENAI_ENDPOINT" \
		-e AZURE_OPENAI_DEPLOYMENT="$$AZURE_OPENAI_DEPLOYMENT" \
		-e AZURE_OPENAI_API_KEY="$$AZURE_OPENAI_API_KEY" \
		-e AZURE_OPENAI_API_VERSION="$$AZURE_OPENAI_API_VERSION" \
		-e SLACK_BOT_TOKEN="$$SLACK_BOT_TOKEN" \
		-e SLACK_APP_TOKEN="$$SLACK_APP_TOKEN" \
		-e SLACK_SIGNING_SECRET="$$SLACK_SIGNING_SECRET" \
		-e SLACK_CLIENT_SECRET="$$SLACK_CLIENT_SECRET" \
		-e SLACK_TEAM_ID="$$SLACK_TEAM_ID" \
		$$LOCAL_AGENT_IMAGE

## ========== Tests ==========

test: setup-venv uv-sync ## Run tests using pytest and coverage
	@uv add pytest-asyncio pytest-cov --dev
	@uv run pytest -v --tb=short --disable-warnings --maxfail=1 --ignore=evals --cov=$(AGENT_PKG_NAME) --cov-report=term --cov-report=xml

## ========== AGNTCY Directory ==========

registry-agntcy-directory:  ## Push agent.json to AGNTCY registry
	@dirctl hub push outshift_platform_engineering/$(AGENT_DIR_NAME) ./$(AGENT_PKG_NAME)/cards/oasf.json

## ========== Release & Versioning ==========
release: setup-venv  ## Bump version and create a release
	@. .venv/bin/activate; uv add commitizen --dev
	@. .venv/bin/activate; git tag -d stable || echo "No stable tag found."
	@. .venv/bin/activate; cz changelog
	@git add CHANGELOG.md
	@git commit -m "docs: update changelog"
	@. .venv/bin/activate; cz bump --increment PATCH
	@. .venv/bin/activate; git tag -f stable
	@echo "Version bumped and stable tag updated successfully."

## ========== Licensing & Help ==========

add-copyright-license-headers: ## Add license headers
	docker run --rm -v $(shell pwd)/$(AGENT_PKG_NAME):/workspace ghcr.io/google/addlicense:latest -c "CNOE" -l apache -s=only -v /workspace

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2}' | sort
