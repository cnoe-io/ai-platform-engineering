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
	generate-docker-compose generate-docker-compose-dev generate-docker-compose-all clean-docker-compose \
	lint lint-fix test test-compose-generator test-compose-generator-coverage \
	test-rag-unit test-rag-coverage test-rag-memory test-rag-scale validate lock-all help

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

## ========== Generate Docker Compose ==========

PERSONAS ?= p2p-basic
OUTPUT_DIR ?= docker-compose
A2A_TRANSPORT ?= p2p
DEV ?= false

generate-docker-compose:  ## Generate docker-compose files from personas (make generate-docker-compose PERSONAS="p2p-basic argocd" DEV=true)
	@echo "Generating docker-compose files for personas: $(PERSONAS)..."
	@mkdir -p $(OUTPUT_DIR)
	@chmod +x scripts/generate-docker-compose.py
	@for persona in $(PERSONAS); do \
		if [ "$(DEV)" = "true" ]; then \
			OUTPUT_FILE="$(OUTPUT_DIR)/docker-compose.$$persona.dev.yaml"; \
		else \
			OUTPUT_FILE="$(OUTPUT_DIR)/docker-compose.$$persona.yaml"; \
		fi; \
		A2A_TRANSPORT=$(A2A_TRANSPORT) ./scripts/generate-docker-compose.py \
			--persona $$persona \
			--output $$OUTPUT_FILE \
			$(if $(filter true,$(DEV)),--dev,); \
		echo "✓ Generated: $$(realpath $$OUTPUT_FILE)"; \
	done
	@echo "✓ Generated compose files in $(OUTPUT_DIR)/"

generate-docker-compose-dev:  ## Generate dev docker-compose files with local code mounts (make generate-docker-compose-dev PERSONAS="p2p-basic")
	@$(MAKE) generate-docker-compose DEV=true

generate-docker-compose-all:  ## Generate docker-compose files for all personas
	@echo "Generating docker-compose files for all personas..."
	@mkdir -p $(OUTPUT_DIR)
	@chmod +x scripts/generate-docker-compose.py
	@A2A_TRANSPORT=$(A2A_TRANSPORT) ./scripts/generate-docker-compose.py \
		--output $(OUTPUT_DIR)/docker-compose.all-personas.yaml \
		$(if $(filter true,$(DEV)),--dev,)
	@echo "✓ Generated docker-compose.all-personas.yaml"

clean-docker-compose:  ## Remove all generated docker-compose files
	@echo "Cleaning generated docker-compose files..."
	@rm -rf $(OUTPUT_DIR)
	@echo "✓ Removed $(OUTPUT_DIR)/"

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

test-compose-generator: setup-venv ## Run unit tests for docker-compose generator
	@echo "Running docker-compose generator tests..."
	@. .venv/bin/activate && uv add pytest pyyaml --dev
	@. .venv/bin/activate && uv run python -m pytest scripts/test_generate_docker_compose.py -v --tb=short

test-compose-generator-coverage: setup-venv ## Run docker-compose generator tests with coverage
	@echo "Running docker-compose generator tests with coverage..."
	@. .venv/bin/activate && uv add pytest pytest-cov pyyaml --dev
	@. .venv/bin/activate && uv run python -m pytest scripts/test_generate_docker_compose.py -v --cov=generate_docker_compose --cov-report=term-missing --cov-report=html

test: setup-venv ## Install dependencies and run tests using pytest
	@echo "Installing ai_platform_engineering, agents, and argocd..."
	@. .venv/bin/activate && uv add pytest-asyncio pytest-mock --group unittest
	@. .venv/bin/activate && uv add ai_platform_engineering/agents/argocd --dev
	@. .venv/bin/activate && uv add ai_platform_engineering/agents/komodor --dev

	@echo "Running general project tests..."
	@. .venv/bin/activate && PYTHONPATH=. uv run pytest --ignore=integration --ignore=ai_platform_engineering/knowledge_bases/rag/tests --ignore=ai_platform_engineering/agents/argocd/mcp/tests --ignore=ai_platform_engineering/agents/jira/mcp/tests --ignore=ai_platform_engineering/multi_agents/tests --ignore=volumes --ignore=docker-compose

	@echo ""
	@echo "Running ArgoCD MCP tests..."
	@. .venv/bin/activate && cd ai_platform_engineering/agents/argocd/mcp && $(MAKE) test

	@echo ""
	@echo "Running Jira MCP tests..."
	@. .venv/bin/activate && cd ai_platform_engineering/agents/jira/mcp && PYTHONPATH=../../.. pytest tests/ -v

	@echo ""
	@echo "Skipping RAG module tests (temporarily disabled)..."
	@echo "✓ RAG tests skipped"

## ========== Multi-Agent Tests ==========

test-multi-agents: setup-venv ## Run multi-agent system tests
	@echo "Running multi-agent system tests..."
	@. .venv/bin/activate && uv run pytest ai_platform_engineering/multi_agents/tests/ -v

## ========== RAG Module Tests ==========

test-rag-unit: setup-venv ## Run RAG module unit tests
	@echo "Running RAG module unit tests..."
	@cd ai_platform_engineering/knowledge_bases/rag && make test-unit

test-rag-coverage: setup-venv ## Run RAG module tests with detailed coverage report
	@echo "Running RAG module tests with coverage analysis..."
	@cd ai_platform_engineering/knowledge_bases/rag && make test-coverage

test-rag-memory: setup-venv ## Run RAG module tests with memory profiling
	@echo "Running RAG module tests with memory profiling..."
	@cd ai_platform_engineering/knowledge_bases/rag && make test-memory

test-rag-scale: setup-venv ## Run RAG module scale tests with memory monitoring
	@echo "Running RAG module scale tests with memory monitoring..."
	@cd ai_platform_engineering/knowledge_bases/rag && make test-scale

# Temporarily disabled - test-all target not found in nested Makefile
# test-rag-all: setup-venv ## Run all RAG module tests (unit, scale, memory, coverage)
# 	@echo "Running comprehensive RAG module test suite..."
# 	@cd ai_platform_engineering/knowledge_bases/rag/server && make test-all

## ========== Integration Tests ==========

quick-sanity: setup-venv  ## Run all integration tests
	@echo "Running AI Platform Engineering integration tests..."
	@uv add httpx rich pytest pytest-asyncio pyyaml --dev
	cd integration && PYTHONPATH=.. A2A_PROMPTS_FILE=test_prompts_quick_sanity.yaml uv run pytest a2a_client_integration_test.py -o log_cli=true

argocd-sanity: setup-venv  ## Run argocd agent integration tests
	@echo "Running argocd agent integration tests..."
	@uv add httpx rich pytest pytest-asyncio pyyaml --dev
	cd integration && PYTHONPATH=.. A2A_PROMPTS_FILE=test_prompts_argocd_sanity.yaml uv run pytest a2a_client_integration_test.py -o log_cli=true -o log_cli_level=INFO

detailed-sanity: detailed-test ## Run tests with verbose output and detailed logs
detailed-test: setup-venv ## Run tests with verbose output and detailed logs
	@echo "Running integration tests with verbose output..."
	@uv add httpx rich pytest pytest-asyncio pyyaml --dev
	cd integration && PYTHONPATH=.. A2A_PROMPTS_FILE=test_prompts_detailed.yaml uv run pytest a2a_client_integration_test.py -o log_cli=true -o log_cli_level=INFO

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

## ========== Release & Versioning ==========
release: setup-venv  ## Bump version and create a release
	@uv tool install commitizen
	@git tag -d stable || echo "No stable tag found."
	@cz changelog
	@git add CHANGELOG.md
	@git commit -m "docs: update changelog"
	@cz bump --increment $${INCREMENT:-PATCH}
	@git tag -f stable
	@echo "Version bumped and stable tag updated successfully."

## ========== Help ==========

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' | sort