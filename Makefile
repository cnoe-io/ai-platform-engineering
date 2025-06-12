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
	build install run test lint help

## ========== Build & Install ==========

build: ## Build the package using Poetry
	@echo "Building the package..."
	@poetry build

install: ## Install the package using Poetry
	@echo "Installing the package..."
	@poetry install

## ========== Run ==========

run: ## Run the application with Poetry
	@echo "Running the application..."
	@poetry run $(APP_NAME) $(ARGS)

run-ai-platform-engineer: ## Run the AI Platform Engineering Multi-Agent System
	@echo "Running the AI Platform Engineering Multi-Agent System..."
	@poetry run ai-platform-engineering platform-engineer $(ARGS)

## ========== Lint ==========

lint: ## Lint the code using Ruff
	@echo "Linting the code..."
	@poetry run ruff check .

## ========== Test ==========

test: ## Run tests using pytest
	@echo "Running tests..."
	@poetry run pytest

## ========== Help ==========

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' | sort