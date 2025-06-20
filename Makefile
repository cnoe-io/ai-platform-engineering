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
	up up-trace down down-trace logs logs-trace test-trace phoenix rebuild clean-docker status health

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

run: setup-venv ## Run the application with Poetry
	@echo "Running the application..."
	@poetry run $(APP_NAME) $(ARGS)

run-ai-platform-engineer: setup-venv ## Run the AI Platform Engineering Multi-Agent System
	@echo "Running the AI Platform Engineering Multi-Agent System..."
	@poetry run ai-platform-engineering platform-engineer $(ARGS)

## ========== Lint ==========

lint: setup-venv ## Lint the code using Ruff
	@echo "Linting the code..."
	@poetry run ruff check .

## ========== Test ==========

test: setup-venv ## Run tests using pytest
	@echo "Running tests..."
	@poetry run pytest


## ========== Docker & Tracing ==========

up: ## Start system without tracing (fast)
	@echo "🚀 Starting AI Platform Engineering (Standard Mode)..."
	@docker-compose --profile default up -d
	@echo "✅ System started at http://localhost:8000"
	@echo "📋 Use 'make up-trace' for tracing mode"

up-trace: ## Start system with Phoenix tracing (builds custom image)
	@echo "🔍 Starting AI Platform Engineering (Tracing Mode)..."
	@echo "⏳ Building custom image with Phoenix tracing..."
	@docker-compose --profile tracing up -d --build
	@echo "✅ System started with tracing!"
	@echo "🔍 Phoenix dashboard: http://localhost:6006"
	@echo "🤖 Platform engineer: http://localhost:8000"
	@echo "🧪 Run 'make test-trace' to generate sample traces"

down: ## Stop all services  
	@echo "🛑 Stopping AI Platform Engineering..."
	@docker-compose --profile default down

down-trace: ## Stop all services including tracing
	@echo "🛑 Stopping AI Platform Engineering (including tracing)..."
	@docker-compose --profile tracing --profile default down

logs: ## Show platform engineer logs (standard mode)
	@echo "📋 Platform Engineer Logs (Standard):"
	@docker-compose logs -f platform-engineer

logs-trace: ## Show platform engineer logs (tracing mode)
	@echo "📋 Platform Engineer Logs (Tracing):"
	@docker-compose --profile tracing logs -f platform-engineer

test-trace: ## Test tracing with sample requests
	@echo "🧪 Testing Phoenix tracing..."
	@echo "📊 Sending sample request to generate traces..."
	@curl -X POST http://localhost:8000/agent/tasks \
		-H "Content-Type: application/json" \
		-d @eval/trace_request_example.json \
		--silent --show-error || echo "❌ Request failed - ensure system is running with 'make up-trace'"
	@echo "✅ Test request sent! Check Phoenix dashboard at http://localhost:6006"

phoenix: ## Open Phoenix dashboard
	@echo "🔍 Opening Phoenix dashboard..."
	@command -v open >/dev/null 2>&1 && open http://localhost:6006 || \
	command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:6006 || \
	echo "🌐 Phoenix dashboard: http://localhost:6006"

rebuild: ## Force rebuild tracing image
	@echo "🔨 Force rebuilding tracing image..."
	@docker-compose --profile tracing build --no-cache

clean-docker: ## Clean up containers and images
	@echo "🧹 Cleaning up containers and images..."
	@docker-compose --profile tracing --profile default down --rmi local --volumes
	@docker system prune -f

status: ## Check service status
	@echo "🏥 Service Status:"
	@echo "=================="
	@docker-compose ps

health: ## Run health checks
	@echo "🏥 Running health checks..."
	@echo ""
	@echo "🔍 Phoenix (Tracing):"
	@curl -s http://localhost:6006/ > /dev/null && echo "✅ Phoenix UI accessible" || echo "❌ Phoenix not accessible"
	@echo ""
	@echo "🤖 Platform Engineer:"
	@curl -s http://localhost:8000/ > /dev/null && echo "✅ Platform Engineer running" || echo "❌ Platform Engineer not accessible"
	@echo ""
	@echo "🐙 GitHub Agent:"
	@curl -s http://localhost:8003/ > /dev/null && echo "✅ GitHub Agent running" || echo "❌ GitHub Agent not accessible"
	@echo ""
	@echo "💬 Slack Agent:"
	@curl -s http://localhost:8005/ > /dev/null && echo "✅ Slack Agent running" || echo "❌ Slack Agent not accessible"

## ========== Help ==========

help: ## Show this help message
	@echo "🤖 AI Platform Engineering - Available Commands:"
	@echo ""
	@echo "📦 Docker & Tracing:"
	@echo "  make up           - Start system without tracing (fast)"
	@echo "  make up-trace     - Start system with Phoenix tracing (builds custom image)"
	@echo "  make down         - Stop all services"
	@echo "  make down-trace   - Stop all services including tracing"
	@echo "  make test-trace   - Run tracing test scripts"
	@echo "  make phoenix      - Open Phoenix dashboard"
	@echo "  make logs         - Show platform engineer logs"
	@echo "  make logs-trace   - Show platform engineer logs (tracing mode)"
	@echo "  make rebuild      - Force rebuild tracing image"
	@echo "  make clean-docker - Clean up containers and images"
	@echo "  make status       - Check service status"
	@echo "  make health       - Run health checks"
	@echo ""
	@echo "🛠️  Development:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		grep -E '^[[:space:]]*(setup|build|install|run|test|lint)' | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' | sort