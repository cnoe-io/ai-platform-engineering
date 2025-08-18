# Common Makefile for CNOE Agent Projects
# --------------------------------------------------
# This Makefile provides common targets for building, testing, and running CNOE agents.
# Usage:
#   make <target>
# --------------------------------------------------

# Variables
AGENT_NAME ?= rag
AGENT_DIR_NAME = kb-$(shell echo $(AGENT_NAME))
AGENT_PKG_NAME ?= kb_$(shell echo $(AGENT_NAME))

.PHONY: \
  build setup-venv activate-venv install run help clean clean-pyc clean-venv clean-build-artifacts \
  install-uv verify-a2a-sdk evals \
  run-a2a run-curl-client \
  test \
  build-docker-a2a build-docker-a2a-tag build-docker-a2a-push build-docker-a2a-tag-and-push \
  run-docker-a2a \
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

## ========== Build & Lint ==========

build: setup-venv  ## Build the package using Poetry
	@$(venv-activate) && poetry build

lint: setup-venv   ## Lint code with ruff (ignoring F401)
	@$(venv-activate) && poetry install && ruff check --ignore F401 $(AGENT_PKG_NAME) tests

ruff-fix: setup-venv ## Auto-fix lint issues with ruff
	@$(venv-activate) && ruff check $(AGENT_PKG_NAME) tests --fix

## ========== Run ==========

run-a2a: setup-venv ## Run A2A agent
	@$(MAKE) check-env
	@$(venv-run) python -m $(AGENT_PKG_NAME).protocol_bindings.a2a_server

## ========== Docker ==========

build-docker-a2a:            ## Build A2A Docker image
	docker build -t $(AGENT_DIR_NAME):a2a-latest -f docker/Dockerfile.a2a .

build-docker-a2a-tag:        ## Tag A2A Docker image
	docker tag $(AGENT_DIR_NAME):a2a-latest ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest

build-docker-a2a-push:       ## Push A2A Docker image
	docker push ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest

build-docker-a2a-tag-and-push: ## Tag and push A2A Docker image
	@$(MAKE) build-docker-a2a build-docker-a2a-tag build-docker-a2a-push

run-docker-a2a: ## Run the A2A agent in Docker
	@A2A_AGENT_PORT=$$(grep A2A_AGENT_PORT .env | cut -d '=' -f2); \
	LOCAL_A2A_AGENT_IMAGE=$${A2A_AGENT_IMAGE:-ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest}; \
	LOCAL_A2A_AGENT_PORT=$${A2A_AGENT_PORT:-8000}; \
	echo "==================================================================="; \
	echo "                      A2A AGENT DOCKER RUN                         "; \
	echo "==================================================================="; \
	echo "Using Agent Image: $$LOCAL_A2A_AGENT_IMAGE"; \
	echo "Using Agent Port: $$LOCAL_A2A_AGENT_PORT"; \
	echo "==================================================================="; \
	docker run -p $$LOCAL_A2A_AGENT_PORT:8000 -it \
		-e AZURE_OPENAI_API_KEY=$$AZURE_OPENAI_API_KEY \
		-e OPENAI_API_VERSION=$$OPENAI_API_VERSION \
		-e AZURE_OPENAI_API_VERSION=$$AZURE_OPENAI_API_VERSION \
		-e AZURE_OPENAI_ENDPOINT=$$AZURE_OPENAI_ENDPOINT \
		-e AZURE_OPENAI_DEPLOYMENT_NAME=$$AZURE_OPENAI_DEPLOYMENT_NAME \
		$$LOCAL_A2A_AGENT_IMAGE

## ========== Tests ==========

test: setup-venv build ## Run tests using pytest and coverage
	@$(venv-activate) && poetry install
	@$(venv-activate) && poetry add pytest-asyncio pytest-cov --dev
	@$(venv-activate) && pytest -v --tb=short --disable-warnings --maxfail=1 --ignore=evals --cov=$(AGENT_PKG_NAME) --cov-report=term --cov-report=xml

## ========== Licensing & Help ==========

add-copyright-license-headers: ## Add license headers
	docker run --rm -v $(shell pwd)/$(AGENT_PKG_NAME):/workspace ghcr.io/google/addlicense:latest -c "CNOE" -l apache -s=only -v /workspace

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2}' | sort 