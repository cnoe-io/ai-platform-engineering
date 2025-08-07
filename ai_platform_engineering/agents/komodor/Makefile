# Common Makefile for CNOE Agent Projects
# --------------------------------------------------
# This Makefile provides common targets for building, testing, and running CNOE agents.
# Usage:
#   make <target>
# --------------------------------------------------

# Variables
AGENT_NAME ?= komodor
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
	@$(venv-run) MCP_MODE=HTTP uv run $(AGENT_PKG_NAME)/protocol_bindings/mcp_server/$(MCP_SERVER_DIR)/server.py

## ========== Clients ==========

run-a2a-client: setup-venv ## Run A2A client script
	@uvx https://github.com/cnoe-io/agent-chat-cli.git a2a


run-mcp-client:  ## Run MCP client script
	@npx @modelcontextprotocol/inspector

langgraph-dev: setup-venv ## Run LangGraph dev mode
	@$(venv-run) langgraph dev

evals: setup-venv ## Run agentevals with test cases
	@$(venv-run) uv add agentevals tabulate pytest
	@$(venv-run) uv run evals/strict_match/test_strict_match.py

## ========== Docker ==========

build-docker-acp:            ## Build ACP Docker image
	docker build -t $(AGENT_DIR_NAME):acp-latest --build-arg AGENT_NAME=komodor -f build/Dockerfile.acp .

build-docker-acp-tag:        ## Tag ACP Docker image
	docker tag $(AGENT_DIR_NAME):acp-latest ghcr.io/cnoe-io/$(AGENT_DIR_NAME):acp-latest

build-docker-acp-push:       ## Push ACP Docker image
	docker push ghcr.io/cnoe-io/$(AGENT_DIR_NAME):acp-latest

build-docker-acp-tag-and-push: ## Tag and push ACP Docker image
	@$(MAKE) build-docker-acp build-docker-acp-tag build-docker-acp-push

build-docker-a2a:            ## Build A2A Docker image
	docker build -t $(AGENT_DIR_NAME):a2a-latest -f build/Dockerfile.a2a .

build-docker-a2a-tag:        ## Tag A2A Docker image
	docker tag $(AGENT_DIR_NAME):a2a-latest ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest

build-docker-a2a-push:       ## Push A2A Docker image
	docker push ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest

build-docker-a2a-tag-and-push: ## Tag and push A2A Docker image
	@$(MAKE) build-docker-a2a build-docker-a2a-tag build-docker-a2a-push

run-docker-acp: ## Run the ACP agent in Docker
	@$(MAKE) check-env
	@AGENT_ID=$$(grep CNOE_AGENT_$$(echo $(AGENT_NAME) | tr a-z A-Z)_ID .env | cut -d '=' -f2); \
	AGENT_PORT=$$(grep CNOE_AGENT_$$(echo $(AGENT_NAME) | tr a-z A-Z)_PORT .env | cut -d '=' -f2); \
	ACP_AGENT_IMAGE=$$(grep ACP_AGENT_IMAGE .env | cut -d '=' -f2 || echo ""); \
	LOCAL_AGENT_PORT=$${AGENT_PORT:-10000}; \
	LOCAL_AGENT_IMAGE=$${ACP_AGENT_IMAGE:-ghcr.io/cnoe-io/$(AGENT_DIR_NAME):acp-latest}; \
	echo "========================================================================"; \
	echo "==                     ACP AGENT DOCKER RUN                           =="; \
	echo "========================================================================"; \
	echo "Using Agent Image : $$LOCAL_AGENT_IMAGE"; \
	echo "Using Agent ID    : $$AGENT_ID"; \
	echo "Using Agent Port  : localhost:$$LOCAL_AGENT_PORT"; \
	echo "========================================================================"; \
	echo "==               Do not use uvicorn port in the logs                  =="; \
	echo "========================================================================"; \
	docker run -p $$LOCAL_AGENT_PORT:8000 -it \
		-v $(PWD)/.env:/opt/agent_src/.env \
		--env-file .env \
		-e AGWS_STORAGE_PERSIST=False \
		-e AGENT_MANIFEST_PATH="manifest.json" \
		-e AGENTS_REF='{"'$$AGENT_ID'": "$(AGENT_PKG_NAME).graph:graph"}' \
		-e AGENT_ID=$$AGENT_ID \
		-e AIOHTTP_CLIENT_MAX_REDIRECTS=10 \
		-e AIOHTTP_CLIENT_TIMEOUT=60 \
		-e API_HOST=0.0.0.0 \
		$$LOCAL_AGENT_IMAGE

# Run Docker container for A2A agent

run-docker-a2a: ## Run the A2A agent in Docker
	@A2A_AGENT_PORT=$$(grep A2A_AGENT_PORT .env | cut -d '=' -f2); \
	LOCAL_A2A_AGENT_IMAGE=$${A2A_AGENT_IMAGE:-ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest}; \
	LOCAL_A2A_AGENT_PORT=$${A2A_AGENT_PORT:-8000}; \
	echo "==================================================================="; \
	echo "                      A2A AGENT DOCKER RUN                         "; \
	echo "==================================================================="; \
	echo "Using Agent Image: $$LOCAL_A2A_AGENT_IMAGE"; \
	echo "Using Agent Port: $$LOCAL_A2A_AGENT_PORT"; \
	echo "==================================================================="; \
	docker run -p $$LOCAL_A2A_AGENT_PORT:8000 -it \
		$$LOCAL_A2A_AGENT_IMAGE

## ========== Tests ==========

test: setup-venv build ## Run tests using pytest and coverage
	@$(venv-activate) && poetry install
	@$(venv-activate) && poetry add pytest-asyncio pytest-cov --dev
	@$(venv-activate) && pytest -v --tb=short --disable-warnings --maxfail=1 --ignore=evals --cov=$(AGENT_PKG_NAME) --cov-report=term --cov-report=xml

## ========== AGNTCY Directory ==========

registry-agntcy-directory:  ## Push agent.json to AGNTCY registry
	@dirctl hub push outshift_platform_engineering/$(AGENT_DIR_NAME) ./$(AGENT_PKG_NAME)/protocol_bindings/acp_server/agent.json

## ========== Licensing & Help ==========

add-copyright-license-headers: ## Add license headers
	docker run --rm -v $(shell pwd)/$(AGENT_PKG_NAME):/workspace ghcr.io/google/addlicense:latest -c "CNOE" -l apache -s=only -v /workspace

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2}' | sort
