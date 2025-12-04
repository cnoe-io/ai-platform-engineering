# Common Makefile for CNOE Agent Projects
# --------------------------------------------------
# This Makefile provides common targets for building, testing, and running CNOE agents.
# Usage:
#   make <target>
# --------------------------------------------------

# Variables
AGENT_NAME ?= aws
AGENT_DIR_NAME = agent-$(shell echo $(AGENT_NAME))
AGENT_PKG_NAME ?= agent_$(shell echo $(AGENT_NAME))

## -------------------------------------------------
.PHONY: \
  build setup-venv activate-venv install run run-acp run-client \
  help clean clean-pyc clean-venv clean-build-artifacts \
  install-uv install-wfsm verify-a2a-sdk evals \
  run-a2a run-acp-client run-a2a-client run-curl-client \
  test registry-agntcy-directory \
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
		echo "Error: .env file not found. Copy .env.example to .env and configure."; exit 1; \
	fi

venv-activate = . .venv/bin/activate
load-env = (set -a; [ -f .env ] && . "$$(readlink -f .env 2>/dev/null || echo .env)" || true; set +a)
venv-run = $(venv-activate) && $(load-env) &&

## ========== Install ==========

install: setup-venv ## Install Python dependencies using Poetry
	@echo "Installing dependencies..."
	@$(venv-activate) && poetry install --no-interaction
	@echo "Dependencies installed successfully."

install-uv:        ## Install uv package manager
	@$(venv-run) pip install uv

install-wfsm:      ## Install workflow server manager (wfsm)
	curl -sSL https://raw.githubusercontent.com/agntcy/workflow-srv-mgr/refs/heads/install-sh-tag-cmd-args/install.sh -t v0.3.1 | bash

## ========== Build & Lint ==========

build: setup-venv  ## Build the package using Poetry
	@$(venv-activate) && poetry build

lint: setup-venv   ## Lint code with ruff
	@$(venv-activate) && poetry install && ruff check $(AGENT_PKG_NAME) tests

ruff-fix: setup-venv ## Auto-fix lint issues with ruff
	@$(venv-activate) && ruff check $(AGENT_PKG_NAME) tests --fix

## ========== Run ==========

run: setup-venv    ## Run the agent locally
	@$(MAKE) check-env
	@REPO_ROOT=$$(git rev-parse --show-toplevel 2>/dev/null || echo "../../.."); \
	export PYTHONPATH=$$REPO_ROOT:$$PYTHONPATH; \
	$(venv-run) python -u $(AGENT_PKG_NAME)/__main__.py

run-a2a: setup-venv ## Run A2A agent with uvicorn (use A2A_HOST and A2A_PORT env vars)
	@$(MAKE) check-env
	@REPO_ROOT=$$(git rev-parse --show-toplevel 2>/dev/null || echo "../../.."); \
	export PYTHONPATH=$$REPO_ROOT:$$PYTHONPATH; \
	A2A_PORT=$$(grep A2A_PORT .env | cut -d '=' -f2); \
	$(venv-run) uv run $(AGENT_PKG_NAME) --host 0.0.0.0 --port $${A2A_PORT:-8502}

run-mcp: setup-venv ## Run MCP server in SSE mode
	@$(MAKE) check-env
	@$(venv-run) MCP_MODE=SSE python -m $(AGENT_PKG_NAME).protocol_bindings.mcp_server

## ========== Test ==========

test: setup-venv   ## Run all tests
	@$(venv-activate) && pytest tests/ -v

test-claude:       ## Run Claude-specific evaluations
	@echo "Running Claude evaluations..."
	@$(venv-run) python evals/strict_match/test_strict_match.py --provider claude

test-openai:       ## Run OpenAI-specific evaluations
	@echo "Running OpenAI evaluations..."
	@$(venv-run) python evals/strict_match/test_strict_match.py --provider openai

test-gemini:       ## Run Gemini-specific evaluations
	@echo "Running Gemini evaluations..."
	@$(venv-run) python evals/strict_match/test_strict_match.py --provider gemini

## ========== Docker ==========

build-docker-a2a: ## Build A2A Docker image
	@REPO_ROOT=$$(git rev-parse --show-toplevel 2>/dev/null || echo "../../.."); \
	docker build -f $$REPO_ROOT/ai_platform_engineering/agents/aws/build/Dockerfile.a2a -t $(AGENT_DIR_NAME):a2a-latest $$REPO_ROOT

build-docker-a2a-tag: ## Tag A2A Docker image
	@docker tag $(AGENT_DIR_NAME):a2a-latest ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-stable

build-docker-a2a-push: ## Push A2A Docker image
	@docker push ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-stable

build-docker-a2a-tag-and-push: build-docker-a2a build-docker-a2a-tag build-docker-a2a-push ## Build, tag, and push A2A Docker image

run-docker-a2a:   ## Run A2A Docker container
	@$(MAKE) check-env
	@docker run -p 0.0.0.0:8000:8000 -it \
		-v "$(PWD)/.env:/app/.env" \
		ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-stable

## ========== Client Tools ==========

run-a2a-client:   ## Run A2A client
	@uvx --no-cache git+https://github.com/cnoe-io/agent-chat-cli.git a2a

## ========== Help ==========

help:              ## Show this help message
	@echo "AWS EKS Agent - Available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Examples:"
	@echo "  make install          # Install dependencies"
	@echo "  make run              # Run agent locally"
	@echo "  make run-a2a          # Run A2A server"
	@echo "  make test             # Run all tests"
	@echo "  make build-docker-a2a # Build Docker image"

## ========== Default ==========

.DEFAULT_GOAL := help
