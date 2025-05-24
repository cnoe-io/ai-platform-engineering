# Makefile
AGENT_NAME=agent_argocd

.PHONY: \
  build setup-venv activate-venv install run run-acp run-client \
  langgraph-dev help clean clean-pyc clean-venv clean-build-artifacts \
  install-uv install-wfsm verify-a2a-sdk evals \
  run-a2a run-acp-client run-a2a-client run-curl-client \
  build-docker-acp build-docker-acp-tag-and-push \
  check-env lint ruff-fix \
  add-copyright-license-headers

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
	@echo "Cleaning up Python bytecode and __pycache__ directories..."
	@find . -type d -name "__pycache__" -exec rm -rf {} + || echo "No __pycache__ directories found."

clean-venv:        ## Remove the virtual environment
	@rm -rf .venv && echo "Virtual environment removed." || echo "No virtual environment found."

clean-build-artifacts: ## Remove dist/, build/, egg-info/
	@echo "Cleaning up build artifacts..."
	@rm -rf dist $(AGENT_NAME).egg-info || echo "No build artifacts found."

clean:             ## Clean all build artifacts and cache
	@$(MAKE) clean-pyc
	@$(MAKE) clean-venv
	@$(MAKE) clean-build-artifacts
	@find . -type d -name ".pytest_cache" -exec rm -rf {} + || echo "No .pytest_cache directories found."

## ========== Helpers ==========

check-env:         ## Internal: check that .env file exists
	@if [ ! -f ".env" ]; then \
		echo "Error: .env file not found."; exit 1; \
	fi

# Define helper variables for environment activation
venv-activate = . .venv/bin/activate
load-env = set -a && . .env && set +a
venv-run = $(venv-activate) && $(load-env) &&

## ========== Install ==========

install-uv:        ## Install the uv package manager
	@$(venv-run) pip install uv

install-wfsm:      ## Install workflow service manager from AGNTCY
	curl -sSL https://raw.githubusercontent.com/agntcy/workflow-srv-mgr/refs/heads/install-sh-tag-cmd-args/install.sh -t v0.3.1 | bash

## ========== Build & Lint ==========

build:             ## Build the package using Poetry
	@poetry build

lint: setup-venv   ## Run ruff linter
	@echo "Running ruff linter..."
	@$(venv-activate) && poetry install && ruff check $(AGENT_NAME) tests

ruff-fix: setup-venv     ## Auto-fix lint errors
	@$(venv-activate) && ruff check $(AGENT_NAME) tests --fix

## ========== Run Targets ==========

run:               ## Run the default agent
	@$(venv-run) python3 -m agent_template

run-acp:           ## Run ACP agent with wfsm
	@$(MAKE) check-env
	@$(venv-run) wfsm deploy -b ghcr.io/sriaradhyula/acp/wfsrv:latest -m ./$(AGENT_NAME)/protocol_bindings/acp_server/agent.json --envFilePath=./.env --dryRun=false

verify-a2a-sdk:    ## Verify A2A SDK is available
	@$(venv-run) python3 -c "import a2a; print('A2A SDK imported successfully')"

run-a2a:           ## Run A2A agent
	@$(MAKE) check-env
	@$(venv-run) uv run $(AGENT_NAME)

run-acp-client:    ## Run the ACP client
	@$(MAKE) check-env
	@$(venv-run) uv run client/acp_client.py

run-a2a-client:    ## Run the A2A client
	@$(MAKE) check-env
	@$(venv-run) uv run client/a2a_client.py

run-curl-client:   ## Run the curl-based test client
	@$(MAKE) check-env
	@$(venv-run) ./client/client_curl.sh

langgraph-dev:     ## Run the agent with LangGraph dev mode
	@$(venv-run) langgraph dev

evals:             ## Run agent evaluation script
	@$(venv-run) uv add agentevals tabulate pytest
	@$(venv-run) uv run evals/strict_match/test_strict_match.py

## ========== Docker ==========

build-docker-acp:  ## Build Docker image for ACP
	@docker build -t $(AGENT_NAME):acp-latest -f build/Dockerfile.acp .

build-docker-acp-tag-and-push: ## Build and push Docker image for ACP
	@$(MAKE) build-docker-acp
	@docker tag $(AGENT_NAME):acp-latest ghcr.io/cnoe-io/$(AGENT_NAME):acp-latest
	@docker push ghcr.io/cnoe-io/$(AGENT_NAME):acp-latest

## ========= Run Docker ==========

run-docker-acp: ## Run the ACP agent in Docker
	@echo "Running Docker container for agent_argocd with agent ID: $$AGENT_ID"
	@AGENT_ID=$$(cat .env | grep CNOE_AGENT_ARGOCD_ID | cut -d '=' -f2); \
	docker run --rm -it \
		-v $(PWD)/.env:/opt/agent_src/.env \
		--env-file .env \
		-e AGWS_STORAGE_PERSIST=False \
		-e AGENT_MANIFEST_PATH="manifest.json" \
		-e AGENT_REF='{"'$$AGENT_ID'": "agent_argocd.graph:graph"}' \
		-e AIOHTTP_CLIENT_MAX_REDIRECTS=10 \
		-e AIOHTTP_CLIENT_TIMEOUT=60 \
		-p 0.0.0.0:8000:10000 \
		ghcr.io/cnoe-io/agent_argocd:acp-latest

## ========= Tests ==========
test: setup-venv build         ## Run all tests excluding evals
	@echo "Running unit tests..."
	@$(venv-activate) && poetry install
	@$(venv-activate) && poetry add pytest-asyncio --dev
	@$(venv-activate) && poetry add pytest-cov --dev
	@$(venv-activate) && pytest -v --tb=short --disable-warnings --maxfail=1 --ignore=evals --cov=$(AGENT_NAME) --cov-report=term --cov-report=xml

## ========= AGNTCY Agent Directory ==========
registry-agntcy-directory: ## Update the AGNTCY directory
	@echo "Registering $(AGENT_NAME) to AGNTCY Agent Directory..."
	@dirctl hub push outshift_platform_engineering/agent_argocd ./$(AGENT_NAME)/protocol_bindings/acp_server/agent.json

## ========== Licensing & Help ==========

add-copyright-license-headers: ## Add license headers with Google tool
	@docker run --rm -v $(shell pwd)/$(AGENT_NAME):/workspace ghcr.io/google/addlicense:latest -c "CNOE" -l apache -s=only -v /workspace

help:              ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-30s %s\n", $$1, $$2}'
