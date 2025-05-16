# Makefile
VENV_PATH := ../.venv


.PHONY: build setup-venv activate-venv install run run-acp run-client langgraph-dev help

add-copyright-license-headers:
	@echo "Adding copyright license headers..."
	docker run --rm -v $(shell pwd)/agent_slack:/workspace ghcr.io/google/addlicense:latest -c "CNOE" -l apache -s=only -v /workspace

setup-venv:
	@echo "======================================="
	@echo " Setting up the Virtual Environment   "
	@echo "======================================="
	@if [ ! -d "$(VENV_PATH)" ]; then \
		python3 -m venv $(VENV_PATH); \
		echo "Virtual environment created."; \
	else \
		echo "Virtual environment already exists."; \
	fi

	@echo "======================================="
	@echo " Activating virtual environment       "
	@echo "======================================="
	@echo "To activate venv manually, run: source $(VENV_PATH)/bin/activate"
	. $(VENV_PATH)/bin/activate


	@echo "======================================="
	@echo " Installing dependencies with Poetry  "
	@echo "======================================="
	. $(VENV_PATH)/bin/activate && poetry install

activate-venv:
	@echo "Activating virtual environment..."
	@if [ -d "$(VENV_PATH)" ]; then \
		. $(VENV_PATH)/bin/activate; \
	else \
		echo "Virtual environment not found. Please run 'make setup-venv' first."; \
	fi

build:
	

	@echo "======================================="
	@echo " Building the package using poetry... "
	@echo "======================================="
	poetry build

install:
	@echo "======================================="
	@echo " Activating virtual environment and    "
	@echo " Installing poetry the current package "
	@echo "======================================="
	. $(VENV_PATH)/bin/activate && poetry install
	. $(VENV_PATH)/bin/activate && pip install dist/agent_slack-0.1.0-py3-none-any.whl


run: build install
	@echo "Running the application..."
	. $(VENV_PATH)/bin/activate && . .env && python3 -m agent_template

run-acp: setup-venv build install
	. $(VENV_PATH)/bin/activate && wfsm deploy -m ./deploy/acp/agent.json -e ./deploy/acp/agent-env.yaml

run-client: build install
	@echo "Running the client..."
	bash -c 'source $(VENV_PATH)/bin/activate && set -a && source .env && set +a && python3 client/client_agent.py'


run-curl-client: build install
	@echo "Running the curl client..."
	. $(VENV_PATH)/bin/activate && set -a && . .env && set +a && \
	./client/client_curl.sh

langgraph-dev: build install
	@echo "Running the LangGraph agent..."
	. $(VENV_PATH)/bin/activate && langgraph dev

help:
	@echo "Available targets:"
	@echo "  setup-venv       Create virtual environment in ../.venv and install dependencies"
	@echo "  activate-venv    Activate the virtual environment"
	@echo "  build            Build the project using poetry"
	@echo "  install          Install the package"
	@echo "  run              Build, install, and run the application"
	@echo "  run-acp          Deploy using wfsm with ACP configuration"
	@echo "  run-client       Run the client application"
	@echo "  langgraph-dev    Run the LangGraph agent"
	@echo "  help             Show this help message"

clean:
	rm -rf dist/ ~/.cache/pypoetry