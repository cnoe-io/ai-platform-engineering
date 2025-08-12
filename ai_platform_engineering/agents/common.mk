# Common Makefile for CNOE Agent Projects
# --------------------------------------------------
# This file provides common targets for building, testing, and running CNOE agents.
# Include this file in your agent's Makefile to get all common functionality.
#
# Required variables to be set in your agent's Makefile:
#   AGENT_NAME - The name of your agent (e.g., slack, github, komodor)
#
# Optional variables:
#   AGENT_DIR_NAME - Defaults to agent-$(AGENT_NAME)
#   AGENT_PKG_NAME - Defaults to agent_$(AGENT_NAME)
#   MCP_SERVER_DIR - Defaults to mcp_$(AGENT_NAME)
# --------------------------------------------------

# Ensure AGENT_NAME is set
ifndef AGENT_NAME
$(error AGENT_NAME must be set before including common.mk)
endif

# Default derived variables
AGENT_DIR_NAME ?= agent-$(AGENT_NAME)
AGENT_PKG_NAME ?= agent_$(AGENT_NAME)
MCP_SERVER_DIR ?= mcp_$(AGENT_NAME)

# Helper variables for virtual environment management
venv-activate = . .venv/bin/activate
load-env = set -a && . .env && set +a
venv-run = $(venv-activate) && $(load-env) &&

## -------------------------------------------------
.DEFAULT_GOAL = run

# Common PHONY targets
.PHONY: \
	build setup-venv clean-pyc clean-venv clean-build-artifacts clean \
	check-env copy-env-from-root \
	uv-sync uv-install \
	lint ruff ruff-fix \
	run run-a2a run-mcp \
	run-a2a-client run-mcp-client \
	langgraph-dev evals test \
	build-docker-a2a build-docker-a2a-tag build-docker-a2a-push build-docker-a2a-tag-and-push \
	run-docker-a2a \
	registry-agntcy-directory \
	add-copyright-license-headers help

## ========== Setup & Clean ==========

setup-venv:        ## Create the Python virtual environment using uv
	@echo "Setting up virtual environment with uv..."
	@if [ ! -d ".venv" ]; then \
		uv venv .venv && echo "Virtual environment created with uv."; \
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
		$(MAKE) copy-env-from-root; \
	fi

copy-env-from-root: ## Copy .env file from root directory
	@echo "Root directory: $(shell git rev-parse --show-toplevel)"
	@if [ -f "../../../.env" ]; then \
		cp ../../../.env . && echo ".env file copied from root directory."; \
	else \
		echo "Error: .env file not found in root directory."; exit 1; \
	fi

## ========== UV Management ==========

uv-sync: setup-venv ## Sync Python dependencies using uv
	@echo "Installing dependencies with uv..."
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

build: setup-venv  ## Build the package
	@echo "Build target for uv-based projects - no specific build step required"

lint: setup-venv     ## Lint code with ruff
	@uv add ruff --dev
	@uv run python -m ruff check $(AGENT_PKG_NAME) tests --select E,F --ignore F403 --ignore E402 --line-length 320

ruff: lint				   ## Run ruff linter (alias for lint)

ruff-fix: setup-venv ## Auto-fix lint issues with ruff
	@uv add ruff --dev
	@uv run python -m ruff check $(AGENT_PKG_NAME) tests --fix

## ========== Run ==========

run: run-a2a ## Run the agent application (default to A2A)

run-a2a: setup-venv check-env uv-sync ## Run A2A agent with uvicorn
	uv run python -m $(AGENT_PKG_NAME) --host 0.0.0.0 --port $${A2A_PORT:-8000}

run-mcp: setup-venv check-env ## Run MCP server in HTTP mode
	@MCP_MODE=HTTP uv run $(AGENT_PKG_NAME)/mcp/$(MCP_SERVER_DIR)/server.py

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

build-docker-a2a:            ## Build A2A Docker image
	docker build -t $(AGENT_DIR_NAME):a2a-latest -f build/Dockerfile.a2a .

build-docker-a2a-tag:        ## Tag A2A Docker image
	docker tag $(AGENT_DIR_NAME):a2a-latest ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest

build-docker-a2a-push:       ## Push A2A Docker image
	docker push ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest

build-docker-a2a-tag-and-push: ## Tag and push A2A Docker image
	@$(MAKE) build-docker-a2a build-docker-a2a-tag build-docker-a2a-push

run-docker-a2a: ## Run the A2A agent in Docker
	@$(MAKE) check-env
	LOCAL_AGENT_PORT=$${AGENT_PORT:-8000}; \
	LOCAL_AGENT_IMAGE=$${A2A_AGENT_IMAGE:-ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest}; \
	echo "========================================================================"; \
	echo "==                     A2A AGENT DOCKER RUN                           =="; \
	echo "========================================================================"; \
	echo "Using Agent Image : $$LOCAL_AGENT_IMAGE"; \
	echo "Using Agent Port  : localhost:$$LOCAL_AGENT_PORT"; \
	echo "========================================================================"; \
	echo "==               Do not use uvicorn port in the logs                  =="; \
	echo "========================================================================"; \
	docker run -p $$LOCAL_AGENT_PORT:8000 -it \
		-v $(PWD)/.env:/app/.env \
		--env-file .env \
		$$LOCAL_AGENT_IMAGE

run-local-docker-a2a: build-docker-a2a
	@A2A_AGENT_IMAGE="$(AGENT_DIR_NAME):a2a-latest" $(MAKE) run-docker-a2a


## ========== Tests ==========

test: setup-venv build ## Run tests using pytest and coverage
	@uv add pytest-asyncio pytest-cov --dev
	@uv run pytest -v --tb=short --disable-warnings --maxfail=1 --ignore=evals --cov=$(AGENT_PKG_NAME) --cov-report=term --cov-report=xml

## ========== AGNTCY Directory ==========

registry-agntcy-directory:  ## Push agent.json to AGNTCY registry
	@dirctl hub push outshift_platform_engineering/$(AGENT_DIR_NAME) ./$(AGENT_PKG_NAME)/protocol_bindings/acp_server/agent.json

## ========== Licensing & Help ==========

add-copyright-license-headers: ## Add license headers
	docker run --rm -v $(shell pwd)/$(AGENT_PKG_NAME):/workspace ghcr.io/google/addlicense:latest -c "CNOE" -l apache -s=only -v /workspace

## ========== Release & Versioning ==========
release: setup-venv  ## Bump version and create a release
	@uv tool install commitizen
	@cz changelog
	@git add CHANGELOG.md
	@git commit -m "docs: update changelog"
	@cz bump --increment $${INCREMENT:-PATCH}
	@echo "Version bumped successfully."

help: ## Show this help message
	@echo "Available targets for $(AGENT_NAME) agent:"
	@echo "Variables:"
	@echo "  AGENT_NAME=$(AGENT_NAME)"
	@echo "  AGENT_DIR_NAME=$(AGENT_DIR_NAME)"
	@echo "  AGENT_PKG_NAME=$(AGENT_PKG_NAME)"
	@echo ""
	@echo "Targets:"
	@grep -h -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2}' | sort
