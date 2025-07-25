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

check-uv: ## Check if uv is installed
	@command -v uv >/dev/null 2>&1 || { echo >&2 "uv is not installed. Please install it first."; }

install-uv: setup-venv check-uv ## Install uv if not already installed
	@echo "Activating virtual environment and installing uv..."
	@. .venv/bin/activate && pip3 install uv

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

## ========== uv sync ==========

uv-sync: install-uv ## Sync the project dependencies using uv
	@echo "Installing the package..."
	@uv sync --no-dev

## ========== Docker Build ==========

build-docker:  ## Build the Docker image
	@echo "Building the Docker image..."
	@docker build -t $(APP_NAME):latest -f build/Dockerfile .

## ========== Run ==========

run: run-ai-platform-engineer ## Run the application with Poetry
	@echo "Running the AI Platform Engineer persona..."

run-ai-platform-engineer: install-uv uv-sync ## Run the AI Platform Engineering Multi-Agent System
	@echo "Running the AI Platform Engineering Multi-Agent System..."
	@uv run ai_platform_engineering/multi_agents platform-engineer $(ARGS)

langgraph-dev: setup-venv ## Run langgraph in development mode
	@echo "Running langgraph dev..."
	@poetry install
	@poetry run pip install langgraph-cli[inmem]
	@cd ai_platform_engineering/multi_agents/platform_engineer && export LANGGRAPH_DEV=true && langgraph dev

## ========== Lint ==========

lint: setup-venv ## Lint the code using Ruff
	@echo "Linting the code..."
	@poetry run ruff check . --select E,F --ignore F403 --ignore E402 --line-length 320

lint-fix: setup-venv ## Automatically fix linting issues using Ruff
	@echo "Fixing linting issues..."
	@poetry run ruff check . --select E,F --ignore F403 --ignore E402 --line-length 320 --fix

## ========== Test ==========

test: setup-venv install ## Install dependencies and run tests using pytest
	@echo "Installing ai_platform_engineering, agents, and argocd..."
	@poetry add ./ai_platform_engineering/agents/argocd --no-interaction --group unittest
	@poetry add ./ai_platform_engineering/agents/komodor --no-interaction --group unittest
	@poetry add pytest-asyncio --group unittest --no-interaction

	@echo "Running tests..."
	@poetry run pytest


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
	@echo "🔁 Recursively locking all Python projects with poetry and uv..."
	@find . -name "pyproject.toml" | while read -r pyproject; do \
		dir=$$(dirname $$pyproject); \
		echo "📂 Entering $$dir"; \
		( \
			cd $$dir || exit 1; \
			echo "📦 Running poetry lock in $$dir"; \
			poetry lock && poetry update; \
			echo "🔒 Running uv lock in $$dir"; \
			uv pip compile pyproject.toml --all-extras --prerelease; \
		); \
	done

## ========== Help ==========

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' | sort