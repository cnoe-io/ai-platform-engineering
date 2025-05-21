# Makefile

.PHONY: build setup-venv activate-venv install run run-acp run-client langgraph-dev help

add-copyright-license-headers:
	@echo "Adding copyright license headers..."
	docker run --rm -v $(shell pwd)/agent_slack:/workspace ghcr.io/google/addlicense:latest -c "CNOE" -l apache -s=only -v /workspace

setup-venv:
	@echo "======================================="
	@echo " Setting up the Virtual Environment   "
	@echo "======================================="
	@if [ ! -d ".venv" ]; then \
		python3 -m venv .venv; \
		echo "Virtual environment created."; \
	else \
		echo "Virtual environment already exists."; \
	fi

	@echo "======================================="
	@echo " Activating virtual environment       "
	@echo "======================================="
	@echo "To activate venv manually, run: source .venv/bin/activate"
	. .venv/bin/activate

clean-pyc:
	@echo "Cleaning up __pycache__ directories..."
	@find . -type d -name "__pycache__" -exec rm -rf {} +

clean-venv:
	@echo "Cleaning up the virtual environment..."
	@if [ -d ".venv" ]; then \
		rm -rf .venv; \
		echo "Virtual environment removed."; \
	else \
		echo "No virtual environment found."; \
	fi
clean-build-artifacts:
	@echo "Cleaning up build artifacts..."
	@if [ -d "build" ]; then \
		rm -rf build; \
		echo "Build artifacts removed."; \
	else \
		echo "No build artifacts found."; \
	fi

	@echo "Cleaning up the build artifacts..."
	@if [ -d "dist" ]; then \
		rm -rf dist; \
		echo "Build artifacts removed."; \
	else \
		echo "No build artifacts found."; \
	fi
	@echo "Cleaning up the A2A SDK..."
	@if [ -d "a2a-python" ]; then \
		rm -rf a2a-python; \
		echo "A2A SDK removed."; \
	else \
		echo "No A2A SDK found."; \
	fi
	@echo "Cleaning up the agent_slack.egg-info..."
	@if [ -d "agent_slack.egg-info" ]; then \
		rm -rf agent_slack.egg-info; \
		echo "agent_slack.egg-info removed."; \
	else \
		echo "No agent_slack.egg-info found."; \
	fi

clean: clean-pyc clean-venv clean-build-artifacts
	@echo "Cleaning up all temporary files..."
	@find . -type d -name "__pycache__" -exec rm -rf {} +
	@find . -type d -name "*.egg-info" -exec rm -rf {} +
	@find . -type d -name ".pytest_cache" -exec rm -rf {} +

install-uv:
	@echo "Installing uv using pip..."
	. .venv/bin/activate && pip install uv

activate-venv:
	@echo "Activating virtual environment..."
	@if [ -d "venv" ]; then \
		. venv/bin/activate; \
	else \
		echo "Virtual environment not found. Please run 'make setup-venv' first."; \
	fi

build:
	@echo "======================================="
	@echo " Building the package using poetry... "
	@echo "======================================="
	poetry build

# install:
# 	@echo "======================================="
# 	@echo " Activating virtual environment and    "
# 	@echo " Installing poetry the current package "
# 	@echo "======================================="
# 	. .venv/bin/activate && poetry install

run: build
	@echo "Running the application..."
	. .venv/bin/activate && . .env && python3 -m agent_template

run-acp: setup-venv build install
	@if [ ! -f ".env" ]; then \
		echo "Error: .env file not found. Please create a .env file before running this target."; \
		exit 1; \
	fi
	. .venv/bin/activate && set -a && . .env && set +a && wfsm deploy \
		-m agent_slack/protocol_bindings/acp_server/agent.json \
		-e agent_slack/protocol_bindings/acp_server/agent-env.yaml \
		--dryRun=false



install-a2a: setup-venv
	@git clone https://github.com/google/a2a-python -b main --depth 1 || { echo "a2a-python repo already cloned or failed to clone."; }
	. .venv/bin/activate && cd a2a-python && pip install -e . && \
		echo "A2A SDK installed successfully."
	. .venv/bin/activate && python3 -c "import a2a; print('A2A SDK imported successfully')"

run-a2a: setup-venv install-uv build install-a2a
	@if [ ! -f ".env" ]; then \
		echo "Error: .env file not found. Please create a .env file before running this target."; \
		exit 1; \
	fi
	@echo "Running the A2A agent..."
	. .venv/bin/activate && set -a && . .env && set +a && uv run agent_slack

run-acp-client: build install
	@echo "Running the client..."
	@if [ ! -f ".env" ]; then \
		echo "Error: .env file not found. Please create a .env file before running this target."; \
		exit 1; \
	fi
	. .venv/bin/activate && set -a && . .env && set +a && \
	uv run client/acp_client.py

run-a2a-client: build install install-a2a
	@echo "Running the client..."
	@if [ ! -f ".env" ]; then \
		echo "Error: .env file not found. Please create a .env file before running this target."; \
		exit 1; \
	fi
	. .venv/bin/activate && set -a && . .env && set +a && \
	uv run client/a2a_client.py

run-curl-client: build install
	@echo "Running the curl client..."
	. .venv/bin/activate && set -a && . .env && set +a && \
	./client/client_curl.sh

langgraph-dev: build install
	@echo "Running the LangGraph agent..."
	. .venv/bin/activate && . .env && langgraph dev

lint: setup-venv
	@echo "Running ruff..."
	. .venv/bin/activate && ruff check agent_slack tests

ruff-fix: setup-venv
	@echo "Running ruff and fix lint errors..."
	. .venv/bin/activate && ruff check agent_slack tests --fix

evals: setup-venv
	@echo "Running Agent Strict Trajectory Matching evals..."
	@echo "Installing agentevals with Poetry..."
	. .venv/bin/activate && uv add agentevals tabulate pytest
	set -a && . .env && set +a && uv run evals/strict_match/test_strict_match.py


help:
	@echo "Available targets:"
	@echo "  setup-venv           Create virtual environment in .venv and install dependencies"
	@echo "  activate-venv        Activate the virtual environment"
	@echo "  build                Build the project using poetry"
	@echo "  install              Install the package"
	@echo "  run                  Build, install, and run the application"
	@echo "  run-acp              Deploy using wfsm with ACP configuration"
	@echo "  install-a2a          Clone and install the A2A SDK"
	@echo "  run-a2a              Run the agent with A2A protocol"
	@echo "  run-acp-client       Run the ACP client application"
	@echo "  run-a2a-client       Run the A2A client application"
	@echo "  run-curl-client      Run the curl client script"
	@echo "  langgraph-dev        Run the LangGraph agent"
	@echo "  lint                 Run ruff linter"
	@echo "  evals                Run Agent Strict Trajectory Matching evals"
	@echo "  add-copyright-license-headers  Add copyright license headers"
	@echo "  help                 Show this help message"
