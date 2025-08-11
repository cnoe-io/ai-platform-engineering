# Integration Tests Makefile for AI Platform Engineering
# --------------------------------------------------
# This Makefile provides targets for running integration tests against
# the AI Platform Engineering agents using the A2A protocol.
#
# Requirements:
#   - uv package manager (automatically installed if missing)
#   - Running AI Platform Engineering services on localhost:8000
# --------------------------------------------------

# Helper variables for virtual environment management
venv-activate = . .venv/bin/activate
load-env = set -a && . .env && set +a 2>/dev/null || true
venv-run = $(venv-activate) && $(load-env) &&

# Test configuration
TEST_FILE ?= integration_ai_platform_engineering.py
PROMPTS_FILE ?= test_prompts.yaml
A2A_HOST ?= localhost
A2A_PORT ?= 8000
A2A_TLS ?= false

## -------------------------------------------------
.DEFAULT_GOAL = test

# PHONY targets
.PHONY: \
	setup-venv clean-venv clean-pyc clean \
	uv-install uv-sync install \
	test test-verbose test-specific test-category \
	lint check-format format \
	check-services validate-prompts \
	help

## ========== Setup & Clean ==========

setup-venv:        ## Create the Python virtual environment using uv
	@echo "Setting up virtual environment with uv..."
	@if [ ! -d ".venv" ]; then \
		uv venv .venv && echo "Virtual environment created with uv."; \
	else \
		echo "Virtual environment already exists."; \
	fi
	@echo "To activate manually, run: source .venv/bin/activate"

clean-venv:        ## Remove the virtual environment
	@rm -rf .venv && echo "Virtual environment removed." || echo "No virtual environment found."

clean-pyc:         ## Remove Python bytecode and __pycache__
	@find . -type d -name "__pycache__" -exec rm -rf {} + || echo "No __pycache__ directories found."
	@find . -type d -name ".pytest_cache" -exec rm -rf {} + || echo "No .pytest_cache directories found."

clean:             ## Clean all build artifacts and cache
	@$(MAKE) clean-pyc
	@$(MAKE) clean-venv

## ========== UV Management ==========

uv-install:        ## Install uv package manager
	@if ! command -v uv &> /dev/null; then \
		echo "Installing uv package manager..."; \
		curl -LsSf https://astral.sh/uv/install.sh | sh; \
		echo "uv installed successfully. Please restart your shell or run: source ~/.bashrc"; \
	else \
		echo "uv is already installed: $$(uv --version)"; \
	fi

uv-sync: setup-venv ## Sync Python dependencies using uv
	@echo "Installing integration test dependencies with uv..."
	@uv add httpx rich a2a-client pytest pytest-asyncio pyyaml --dev
	@echo "Dependencies installed successfully."

install: uv-install uv-sync ## Install uv and sync dependencies (alias)

## ========== Test Execution ==========

test: setup-venv uv-sync ## Run all integration tests
	@echo "Running AI Platform Engineering integration tests..."
	@echo "Target: $(A2A_HOST):$(A2A_PORT)"
	@echo "Prompts: $(PROMPTS_FILE)"
	@echo "=========================================="
	@A2A_HOST=$(A2A_HOST) \
	 A2A_PORT=$(A2A_PORT) \
	 A2A_TLS=$(A2A_TLS) \
	 A2A_PROMPTS_FILE=$(PROMPTS_FILE) \
	 uv run pytest $(TEST_FILE) -v --tb=short

test-verbose: setup-venv uv-sync ## Run tests with verbose output and detailed logs
	@echo "Running integration tests with verbose output..."
	@A2A_HOST=$(A2A_HOST) \
	 A2A_PORT=$(A2A_PORT) \
	 A2A_TLS=$(A2A_TLS) \
	 A2A_PROMPTS_FILE=$(PROMPTS_FILE) \
	 uv run pytest $(TEST_FILE) -vvv --tb=long --log-cli-level=INFO

test-specific:     ## Run specific test (usage: make test-specific TEST_NAME=test_github_info)
	@if [ -z "$(TEST_NAME)" ]; then \
		echo "Error: TEST_NAME must be specified. Example: make test-specific TEST_NAME=test_github_info"; \
		exit 1; \
	fi
	@echo "Running specific test: $(TEST_NAME)"
	@A2A_HOST=$(A2A_HOST) \
	 A2A_PORT=$(A2A_PORT) \
	 A2A_TLS=$(A2A_TLS) \
	 A2A_PROMPTS_FILE=$(PROMPTS_FILE) \
	 uv run pytest $(TEST_FILE) -k "$(TEST_NAME)" -v --tb=short

test-category:     ## Run tests by category (usage: make test-category CATEGORY=github)
	@if [ -z "$(CATEGORY)" ]; then \
		echo "Error: CATEGORY must be specified. Example: make test-category CATEGORY=github"; \
		echo "Available categories: github, argocd, pagerduty, slack, jira, general"; \
		exit 1; \
	fi
	@echo "Running tests for category: $(CATEGORY)"
	@A2A_HOST=$(A2A_HOST) \
	 A2A_PORT=$(A2A_PORT) \
	 A2A_TLS=$(A2A_TLS) \
	 A2A_PROMPTS_FILE=$(PROMPTS_FILE) \
	 uv run pytest $(TEST_FILE) -k "$(CATEGORY)" -v --tb=short

## ========== Code Quality ==========

lint: setup-venv  ## Lint code with ruff
	@uv add ruff --dev
	@uv run python -m ruff check . --select E,F --ignore F403 --ignore E402 --line-length 120

check-format: setup-venv ## Check code formatting
	@uv add ruff --dev
	@uv run python -m ruff format --check .

format: setup-venv ## Auto-format code with ruff
	@uv add ruff --dev
	@uv run python -m ruff format .

## ========== Validation ==========

check-services:    ## Check if AI Platform Engineering services are running
	@echo "Checking if services are available at $(A2A_HOST):$(A2A_PORT)..."
	@if curl -sf http://$(A2A_HOST):$(A2A_PORT)/.well-known/agent.json > /dev/null 2>&1; then \
		echo "✅ Services are running and accessible"; \
		curl -s http://$(A2A_HOST):$(A2A_PORT)/.well-known/agent.json | grep -o '"name":"[^"]*"' || echo "Agent info retrieved"; \
	else \
		echo "❌ Services are not accessible at http://$(A2A_HOST):$(A2A_PORT)"; \
		echo "Please ensure AI Platform Engineering services are running"; \
		echo "Try: docker compose -f docker-compose.slim.yaml --profile=slim up -d"; \
		exit 1; \
	fi

validate-prompts:  ## Validate the YAML prompts file
	@echo "Validating prompts file: $(PROMPTS_FILE)"
	@if [ ! -f "$(PROMPTS_FILE)" ]; then \
		echo "❌ Prompts file not found: $(PROMPTS_FILE)"; \
		exit 1; \
	fi
	@uv add pyyaml --dev
	@uv run python -c "import yaml; yaml.safe_load(open('$(PROMPTS_FILE)'))" && \
		echo "✅ Prompts file is valid YAML" || \
		(echo "❌ Prompts file contains invalid YAML"; exit 1)
	@PROMPT_COUNT=$$(uv run python -c "import yaml; print(len(yaml.safe_load(open('$(PROMPTS_FILE)'))['prompts']))"); \
		echo "✅ Found $$PROMPT_COUNT test prompts"

## ========== Convenience Targets ==========

run: test          ## Run integration tests (alias for test)

check: check-services validate-prompts ## Run all validation checks

quick-test: check-services ## Quick test run (check services then run tests)
	@$(MAKE) test

ci-test: install check-services validate-prompts test ## Full CI test pipeline

## ========== Help ==========

help:              ## Show this help message
	@echo "AI Platform Engineering Integration Tests"
	@echo "========================================"
	@echo ""
	@echo "Configuration:"
	@echo "  A2A_HOST=$(A2A_HOST)"
	@echo "  A2A_PORT=$(A2A_PORT)"
	@echo "  A2A_TLS=$(A2A_TLS)"
	@echo "  TEST_FILE=$(TEST_FILE)"
	@echo "  PROMPTS_FILE=$(PROMPTS_FILE)"
	@echo ""
	@echo "Usage Examples:"
	@echo "  make test                              # Run all tests"
	@echo "  make test-verbose                      # Run with detailed output"
	@echo "  make test-specific TEST_NAME=github_info   # Run specific test"
	@echo "  make test-category CATEGORY=github    # Run tests by category"
	@echo "  make check-services                    # Check if services are running"
	@echo "  make A2A_HOST=remote.example.com test  # Test against remote host"
	@echo ""
	@echo "Available targets:"
	@grep -h -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' | sort
