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
	build install run test lint help \
	tracing-setup tracing-test tracing-start tracing-stop tracing-logs tracing-clean

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

## ========== Build & Install ==========

build: setup-venv ## Build the package using Poetry
	@echo "Building the package..."
	@poetry build

install: setup-venv ## Install the package using Poetry
	@echo "Installing the package..."
	@poetry install

## ========== Docker Build ==========

build-docker:  ## Build the Docker image
	@echo "Building the Docker image..."
	@docker build -t $(APP_NAME):latest -f build/Dockerfile .

## ========== Run ==========

run: run-ai-platform-engineer ## Run the application with Poetry
	@echo "Running the AI Platform Engineer persona..."

run-ai-platform-engineer: setup-venv build install ## Run the AI Platform Engineering Multi-Agent System
	@echo "Running the AI Platform Engineering Multi-Agent System..."
	@poetry run ai-platform-engineering platform-engineer $(ARGS)

langgraph-dev: setup-venv ## Run langgraph in development mode
	@echo "Running langgraph dev..."
	@export LANGGRAPH_DEV=true && langgraph dev

## ========== Lint ==========

lint: setup-venv ## Lint the code using Ruff
	@echo "Linting the code..."
	@poetry run ruff check .

## ========== Test ==========

test: setup-venv ## Run tests using pytest
	@echo "Running tests..."
	@poetry run pytest



tracing-test: setup-venv install ## Test tracing implementation
	@echo "🧪 Testing cross-container tracing implementation..."
	@poetry run python test_tracing.py

tracing-test-supervisor: setup-venv install ## Test supervisor agent with real tracing
	@echo "🤖 Testing supervisor agent with tracing..."
	@poetry run python -c "import asyncio; from ai_platform_engineering.mas.platform_engineer.supervisor_agent import AIPlatformEngineerMAS; supervisor = AIPlatformEngineerMAS(); print('Response:', asyncio.run(supervisor.serve('What GitHub repositories are available?', user_id='test-user')))"

tracing-start: ## Start Langfuse tracing services
	@echo "🚀 Starting Langfuse tracing services..."
	@echo "📥 Pulling images first..."
	@docker pull postgres:15 || echo "⚠️  Postgres pull failed, trying to continue..."
	@docker pull clickhouse/clickhouse-server:23.8 || echo "⚠️  ClickHouse pull failed, trying to continue..."
	@docker pull langfuse/langfuse:latest || echo "⚠️  Langfuse pull failed, trying to continue..."
	@echo "🔄 Starting services..."
	@docker compose -f docker-compose.tracing.yaml up -d langfuse postgres clickhouse
	@echo "⏳ Waiting for services to be ready..."
	@sleep 15
	@echo "✅ Langfuse services started"
	@echo "📊 Langfuse UI: http://localhost:3000"

tracing-start-full: ## Start full AI Platform with tracing
	@echo "🚀 Starting full AI Platform with tracing..."
	@docker compose -f docker-compose.tracing.yaml up -d
	@echo "📊 Langfuse UI: http://localhost:3000"
	@echo "🤖 AI Platform: http://localhost:8000"

tracing-stop: ## Stop Langfuse tracing services
	@echo "🛑 Stopping Langfuse tracing services..."
	@docker compose -f docker-compose.tracing.yaml down

tracing-logs: ## Show logs from tracing services
	@echo "📋 Showing Langfuse service logs..."
	@docker compose -f docker-compose.tracing.yaml logs -f langfuse

tracing-clean: ## Clean up tracing services and volumes
	@echo "🧹 Cleaning up tracing services and volumes..."
	@docker compose -f docker-compose.tracing.yaml down -v
	@docker system prune -f

tracing-status: ## Check status of tracing services
	@echo "📊 Checking tracing service status..."
	@docker compose -f docker-compose.tracing.yaml ps

tracing-health: ## Check health of tracing implementation
	@echo "🏥 Checking tracing health..."
	@poetry run python -c "import sys; from ai_platform_engineering.utils.tracing import langfuse_tracing; health = langfuse_tracing.health_check(); print('Langfuse Health Check:'); [print(f\"  {'✅' if v else '❌'} {k}: {v}\") for k, v in health.items()]; sys.exit(0 if health['tracing_enabled'] else 1)"

## ========== Help ==========

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' | sort