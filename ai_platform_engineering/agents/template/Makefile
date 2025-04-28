# Makefile

.PHONY: build setup help

setup:
	@echo "Creating virtual environment in .venv inside project directory..."
	export POETRY_VIRTUALENVS_IN_PROJECT=true && poetry install --no-root

venv/bin/activate:
	@echo "Setting up virtual environment..."
	@if [ ! -d "venv" ]; then \
		python3 -m venv venv; \
	fi
	@echo "Activating virtual environment and installing requirements..."
	. venv/bin/activate && pip install -r requirements.txt

setup-venv:
	@echo "Setting up virtual environment using venv..."
	@if [ ! -d "venv" ]; then \
		python3 -m venv venv; \
	fi
	@echo "Activating virtual environment and installing requirements..."
	. venv/bin/activate && poetry install

build:
	poetry build

install:
	@echo "Installing the package..."
	. venv/bin/activate && poetry install

run: build install
	@echo "Running the application..."
	. venv/bin/activate && . .env && python3 -m agent_template

run-acp: build install
	wfsm deploy -m ./deploy/acp/agent.json -e ./deploy/acp/agent-env.yaml

run-client: build install
	@echo "Running the client..."
	. venv/bin/activate && . .env && python3 client/client_agent_template.py

help:
	@echo "Available targets:"
	@echo "  setup    Create virtual environment in .venv and install dependencies"
	@echo "  build    Build the project using poetry"
	@echo "  help     Show this help message"
