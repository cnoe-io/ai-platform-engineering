# Common Makefile for CNOE Agent Projects
# --------------------------------------------------
# This Makefile provides common targets for building, testing, and running CNOE agents.
# Usage:
#   make <target>
# --------------------------------------------------

# Variables
APP_NAME ?= ai-platform-engineering

## -------------------------------------------------
.PHONY: \
	setup-venv start-venv clean-pyc clean-venv clean-build-artifacts clean \
	build install build-docker run run-ai-platform-engineer langgraph-dev \
	lint lint-fix test validate lock-all help

.DEFAULT_GOAL := run

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

start-venv: ## Activate the virtual environment (run: source .venv/bin/activate)
	@echo "To activate the virtual environment, run:"
	@echo "  source .venv/bin/activate"

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

## ========== Docker Build ==========

build: build-docker

build-docker:  ## Build the Docker image
	@echo "Building the Docker image..."
	@docker build -t $(APP_NAME):latest -f build/Dockerfile .

## ========== Run ==========

run: run-ai-platform-engineer ## Run the application with uv
	@echo "Running the AI Platform Engineer persona..."

run-ai-platform-engineer: setup-venv ## Run the AI Platform Engineering Multi-Agent System
	@echo "Running the AI Platform Engineering Multi-Agent System..."
	@uv sync --no-dev
	@uv run python -m ai_platform_engineering.multi_agents platform-engineer $(ARGS)

langgraph-dev: setup-venv ## Run langgraph in development mode
	@echo "Running langgraph dev..."
	@. .venv/bin/activate && uv add langgraph-cli[inmem] --dev && uv sync --dev && cd ai_platform_engineering/multi_agents/platform_engineer && LANGGRAPH_DEV=true langgraph dev

## ========== Lint ==========

lint: setup-venv ## Lint the code using Ruff
	@echo "Linting the code..."
	@uv add ruff --dev
	@uv run python -m ruff check . --select E,F --ignore F403 --ignore E402 --line-length 320

lint-fix: setup-venv ## Automatically fix linting issues using Ruff
	@echo "Fixing linting issues..."
	@uv add ruff --dev
	@uv run python -m ruff check . --select E,F --ignore F403 --ignore E402 --line-length 320 --fix

## ========== Test ==========

test: setup-venv install ## Install dependencies and run tests using pytest
	@echo "Installing ai_platform_engineering, agents, and argocd..."
	@. .venv/bin/activate && uv pip install -e ./ai_platform_engineering/agents/argocd
	@. .venv/bin/activate && uv pip install -e ./ai_platform_engineering/agents/komodor
	@. .venv/bin/activate && uv add pytest-asyncio --group unittest

	@echo "Running tests..."
	@. .venv/bin/activate && uv run pytest

## ========== Integration Tests ==========

quick-sanity: setup-venv  ## Run all integration tests
	@echo "Running AI Platform Engineering integration tests..."
	@uv add httpx rich pytest pytest-asyncio pyyaml --dev
	cd integration && A2A_PROMPTS_FILE=test_prompts_quick_sanity.yaml uv run pytest -o log_cli=true -o log_cli_level=INFO

detailed-test: setup-venv ## Run tests with verbose output and detailed logs
	@echo "Running integration tests with verbose output..."
	@uv add httpx rich pytest pytest-asyncio pyyaml --dev
	cd integration && A2A_PROMPTS_FILE=test_prompts_detailed.yaml pytest -o log_cli=true -o log_cli_level=INFO



validate:
	@echo "Validating code..."
	@echo "========================================"
	@echo "Running linting to check code quality..."
	@echo "========================================"
	@$(MAKE) lint

	@echo "========================================"
	@echo "Running tests to ensure code correctness..."
	@echo "========================================"
	@$(MAKE) test
	@echo "Validation complete."

lock-all:
	@echo "🔁 Recursively locking all Python projects with uv..."
	@find . -name "pyproject.toml" | while read -r pyproject; do \
		dir=$$(dirname $$pyproject); \
		echo "📂 Entering $$dir"; \
		( \
			cd $$dir || exit 1; \
			echo "🔒 Running uv lock in $$dir"; \
			uv pip compile pyproject.toml --all-extras --prerelease; \
		); \
	done

## ========== Help ==========

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' | sort