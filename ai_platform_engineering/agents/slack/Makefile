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
  build setup-venv activate-venv install run run-acp run-client \
  langgraph-dev help clean clean-pyc clean-venv clean-build-artifacts \
  install-uv install-wfsm verify-a2a-sdk evals \
  run-a2a run-acp-client run-a2a-client run-curl-client \
  run-mcp run-mcp-client test registry-agntcy-directory \
  build-docker-acp build-docker-acp-tag build-docker-acp-push build-docker-acp-tag-and-push \
  build-docker-a2a build-docker-a2a-tag build-docker-a2a-push build-docker-a2a-tag-and-push \
  run-docker-acp run-docker-a2a \
  check-env lint ruff-fix \
  help add-copyright-license-headers

## ========== Setup & Clean ==========

setup-venv:        ## Create the Python virtual environment
	@echo "Setting up virtual environment..."
	@if [ ! -d ".venv" ]; then \
		python3 -m venv .venv && echo "Virtual environment created."; \
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
		echo "Error: .env file not found."; exit 1; \
	fi

venv-activate = . .venv/bin/activate
load-env = set -a && . .env && set +a
venv-run = $(venv-activate) && $(load-env) &&

## ========== Install ==========

install: setup-venv ## Install Python dependencies using Poetry
	@echo "Installing dependencies..."
	@$(venv-activate) && poetry install --no-interaction
	@echo "Dependencies installed successfully."

install-uv:        ## Install uv package manager
	@$(venv-run) pip install uv


install-wfsm:      ## Install workflow server manager (wfsm)
	curl -sSL https://raw.githubusercontent.com/agntcy/workflow-srv-mgr/v0.3.1/install.sh | bash

install-a2a: setup-venv ## Install A2A SDK
	@git clone https://github.com/google/a2a-python -b main --depth 1 || { echo "a2a-python repo already cloned or failed to clone."; }
	@. .venv/bin/activate && cd a2a-python && pip install -e . && \
		echo "A2A SDK installed successfully."
	@. .venv/bin/activate && python3 -c "import a2a; print('A2A SDK imported successfully')"

## ========== Build & Lint ==========

build: setup-venv  ## Build the package using Poetry
	@$(venv-activate) && poetry build

lint: setup-venv   ## Lint code with ruff
	@$(venv-activate) && poetry install && ruff check $(AGENT_PKG_NAME) tests

ruff-fix: setup-venv ## Auto-fix lint issues with ruff
	@$(venv-activate) && ruff check $(AGENT_PKG_NAME) tests --fix

## ========== Run ==========

run-acp: setup-venv ## Deploy ACP agent via wfsm
	@$(MAKE) check-env
	@AGENT_ID=$$(grep CNOE_AGENT_$$(echo $(AGENT_NAME) | tr a-z A-Z)_ID .env | cut -d '=' -f2 | tr -d '"'); \
	if [ -z "$$AGENT_ID" ]; then \
		echo "Error: CNOE_AGENT_SLACK_ID not found in .env file"; \
		exit 1; \
	fi; \
	echo "========================================================================"; \
	echo "==                     ACP AGENT DEPLOYMENT                           =="; \
	echo "========================================================================"; \
	echo "Using Agent ID: $$AGENT_ID"; \
	echo "========================================================================"; \
	AGENTS_REF='{"'$$AGENT_ID'": "agent_slack.graph:AGENT_GRAPH"}' \
	$(venv-run) wfsm deploy \
		-b ghcr.io/sriaradhyula/acp/wfsrv:latest \
		-m ./agent_slack/protocol_bindings/acp_server/agent.json \
		--envFilePath=./.env \
		--dryRun=false


run-a2a: setup-venv ## Run A2A agent with uvicorn
	@$(MAKE) check-env
	@A2A_AGENT_PORT=$$(grep A2A_AGENT_PORT .env | cut -d '=' -f2); \
	$(venv-run) uv run $(AGENT_PKG_NAME) --host 0.0.0.0 --port $${A2A_AGENT_PORT:-8000}

run-mcp: setup-venv ## Run MCP server in SSE mode
	@$(MAKE) check-env
	@$(venv-run) MCP_MODE=SSE uv run $(AGENT_PKG_NAME)/protocol_bindings/mcp_server/$(MCP_SERVER_DIR)/server.py

## ========== Clients ==========

run-a2a-client: setup-venv ## Run A2A client script
	@$(MAKE) check-env
	@$(venv-run) uvx https://github.com/cnoe-io/agent-chat-cli.git a2a

run-mcp-client: setup-venv ## Run MCP client script
	@$(MAKE) check-env
	@$(venv-run) uvx https://github.com/cnoe-io/agent-chat-cli.git mcp

langgraph-dev: setup-venv ## Run LangGraph dev mode
	@$(venv-run) langgraph dev

evals: setup-venv ## Run agentevals with test cases
	@$(venv-run) uv add agentevals tabulate pytest
	@$(venv-run) uv run evals/strict_match/test_strict_match.py

## ========== Docker ==========

build-docker-acp:            ## Build ACP Docker image
	docker build -t $(AGENT_DIR_NAME):acp-latest --build-arg AGENT_NAME=slack -f build/Dockerfile.acp .

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
	@AGENT_ID=$$(grep CNOE_AGENT_$$(echo $(AGENT_NAME) | tr a-z A-Z)_ID .env | cut -d '=' -f2 | tr -d '"'); \
	AGENT_PORT=$$(grep CNOE_AGENT_$$(echo $(AGENT_NAME) | tr a-z A-Z)_PORT .env | cut -d '=' -f2 | tr -d '"'); \
	ACP_AGENT_IMAGE=$$(grep ACP_AGENT_IMAGE .env | cut -d '=' -f2 || echo ""); \
	AZURE_OPENAI_ENDPOINT=$$(grep AZURE_OPENAI_ENDPOINT .env | cut -d '=' -f2 | tr -d '"'); \
	AZURE_OPENAI_DEPLOYMENT=$$(grep AZURE_OPENAI_DEPLOYMENT .env | cut -d '=' -f2 | tr -d '"'); \
	AZURE_OPENAI_API_KEY=$$(grep AZURE_OPENAI_API_KEY .env | cut -d '=' -f2 | tr -d '"'); \
	AZURE_OPENAI_API_VERSION=$$(grep AZURE_OPENAI_API_VERSION .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_BOT_TOKEN=$$(grep SLACK_BOT_TOKEN .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_APP_TOKEN=$$(grep SLACK_APP_TOKEN .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_SIGNING_SECRET=$$(grep SLACK_SIGNING_SECRET .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_CLIENT_SECRET=$$(grep SLACK_CLIENT_SECRET .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_TEAM_ID=$$(grep SLACK_TEAM_ID .env | cut -d '=' -f2 | tr -d '"'); \
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
		-e AGENTS_REF="{\"$$AGENT_ID\": \"$(AGENT_PKG_NAME).graph:AGENT_GRAPH\"}" \
		-e AGENT_ID=$$AGENT_ID \
		-e AIOHTTP_CLIENT_MAX_REDIRECTS=10 \
		-e AIOHTTP_CLIENT_TIMEOUT=60 \
		-e API_HOST=0.0.0.0 \
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

# Run Docker container for A2A agent

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
