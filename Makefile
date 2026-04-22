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
	uv-prep install-deps \
	build install build-docker run run-ai-platform-engineer langgraph-dev \
	run-a2a run-a2a-client run-a2a-client-local \
	generate-docker-compose generate-docker-compose-dev generate-docker-compose-all clean-docker-compose \
	generate-agent-commands \
	lint lint-fix test test-compose-generator test-compose-generator-coverage \
	test-slack-stream test-slack-conformance \
	test-rag-unit test-rag-coverage test-rag-memory test-rag-scale validate lock-all help \
	beads-gh-issues-sync beads-gh-issues-sync-run beads-list beads-ready beads-sync \
	caipe-ui caipe-ui-install caipe-ui-build caipe-ui-dev caipe-ui-tests \
	build-caipe-ui run-caipe-ui-docker caipe-ui-docker-compose \
	docs docs-install docs-build docs-dev docs-start docs-serve \
	check-helm-docs helm-docs check-yq docs-helm-charts docs-helm-validate \
	scan-images scan-image \
	ui

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

uv-prep: ## Lock and sync uv dependencies
	uv lock
	uv sync

install-deps: uv-prep ## Install all dependencies

run-a2a: install-deps ## Run the AI Platform Engineer single-node deep agent with A2A protocol
	@PORT=$${PORT:-8000}; \
	HOST=$${HOST:-0.0.0.0}; \
	export A2A_HOST=$$HOST; \
	export A2A_PORT=$$PORT; \
	export A2A_PUBLIC_URL=http://localhost:$$PORT; \
	export MONGODB_URI=$${MONGODB_URI:-mongodb://admin:changeme@localhost:27017/caipe?authSource=admin}; \
	export MONGODB_DATABASE=$${MONGODB_DATABASE:-caipe}; \
	export PYTHONPATH="$${PWD}/ai_platform_engineering/agents/github:$${PWD}/ai_platform_engineering/agents/backstage:$${PWD}/ai_platform_engineering/agents/jira:$${PWD}/ai_platform_engineering/agents/webex:$${PWD}/ai_platform_engineering/agents/argocd:$${PWD}/ai_platform_engineering/agents/aigateway:$${PWD}/ai_platform_engineering/agents/pagerduty:$${PWD}/ai_platform_engineering/agents/slack:$${PWD}/ai_platform_engineering/agents/splunk:$${PWD}/ai_platform_engineering/agents/komodor:$${PWD}/ai_platform_engineering/agents/confluence:$${PWD}/ai_platform_engineering/agents/aws:$${PYTHONPATH}"; \
	echo "Starting AI Platform Engineer A2A server (single-node) on $$HOST:$$PORT"; \
	uv run uvicorn ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.main:app --host $$HOST --port $$PORT --reload

run-a2a-client: ## Run the agent-chat-cli client to connect to the A2A agent
	@HOST=$${A2A_HOST:-localhost}; \
	PORT=$${A2A_PORT:-8000}; \
	echo "Connecting to A2A agent at $$HOST:$$PORT..."; \
	docker run -it --network=host \
		-e A2A_HOST=$$HOST \
		-e A2A_PORT=$$PORT \
		ghcr.io/cnoe-io/agent-chat-cli:stable

run-a2a-client-local: setup-venv ## Run agent-chat-cli from local source
	@HOST=$${A2A_HOST:-localhost}; \
	PORT=$${A2A_PORT:-8000}; \
	echo "Running local agent-chat-cli connecting to $$HOST:$$PORT..."; \
	cd agent-chat-cli && A2A_HOST=$$HOST A2A_PORT=$$PORT uv run python -m agent_chat_cli a2a

## ========== CAIPE UI ==========

ui: caipe-ui ## Alias for caipe-ui

caipe-ui: caipe-ui-install caipe-ui-dev ## Build and run the CAIPE UI (install + dev server)

caipe-ui-install: ## Install CAIPE UI dependencies
	@echo "Installing CAIPE UI dependencies..."
	@cd ui && npm install

caipe-ui-build: caipe-ui-install ## Build CAIPE UI for production
	@echo "Building CAIPE UI for production..."
	@cd ui && npm run build

caipe-ui-dev: ## Run CAIPE UI in development mode
	@echo "Starting CAIPE UI development server..."
	@cd ui && npm run dev

caipe-ui-tests: ## Run CAIPE UI Jest tests
	@echo "Running CAIPE UI tests..."
	@cd ui && npm test

# Docker targets for CAIPE UI
CAIPE_UI_IMAGE ?= caipe-ui
CAIPE_UI_TAG ?= local

build-caipe-ui: ## Build CAIPE UI Docker image locally
	@echo "Building CAIPE UI Docker image..."
	docker build -t $(CAIPE_UI_IMAGE):$(CAIPE_UI_TAG) \
		-f build/Dockerfile.caipe-ui \
		--build-arg CAIPE_URL=http://caipe-supervisor:8000 \
		.

run-caipe-ui-docker: build-caipe-ui ## Run CAIPE UI container locally (requires caipe-supervisor)
	@echo "Running CAIPE UI container..."
	docker run --rm -it \
		-p 3000:3000 \
		-e NEXT_PUBLIC_CAIPE_URL=http://localhost:8000 \
		-e CAIPE_URL=http://localhost:8000 \
		-e NEXTAUTH_SECRET=caipe-dev-secret \
		-e NEXTAUTH_URL=http://localhost:3000 \
		--name caipe-ui-local \
		$(CAIPE_UI_IMAGE):$(CAIPE_UI_TAG)

caipe-ui-docker-compose: ## Run CAIPE UI with docker-compose (includes supervisor)
	@echo "Starting CAIPE UI with docker-compose..."
	docker compose -f docker-compose.dev.yaml --profile caipe-ui up --build

## ========== Documentation (Docusaurus) ==========

docs: docs-install docs-start ## Install dependencies and start documentation development server

docs-install: ## Install documentation site dependencies
	@echo "Installing documentation dependencies..."
	@cd docs && npm install

docs-build: docs-install ## Build documentation static site
	@echo "Building documentation site..."
	@cd docs && npm run build

docs-dev: ## Start documentation development server with auto-reload
	@echo "Starting documentation development server..."
	@echo "Site will be available at http://localhost:3001"
	@cd docs && npm run start -- --port 3001

docs-start: docs-dev ## Alias for docs-dev (start documentation development server)

docs-serve: docs-build ## Serve documentation static site
	@echo "Serving documentation static site..."
	@cd docs && npm run serve

## ========== Spec-Kit Agent Commands ==========

SPECKIT_SRC := .specify/templates/commands
CURSOR_DST  := .cursor/commands
CLAUDE_DST  := .claude/commands

generate-agent-commands: ## Generate .cursor and .claude command files from .specify/templates/commands
	@echo "Generating agent command files from $(SPECKIT_SRC)..."
	@mkdir -p $(CURSOR_DST) $(CLAUDE_DST)
	@for src in $(SPECKIT_SRC)/*.md; do \
		name=$$(basename "$$src" .md); \
		cp "$$src" "$(CURSOR_DST)/speckit.$$name.md"; \
		cp "$$src" "$(CLAUDE_DST)/speckit.$$name.md"; \
	done
	@echo "✓ Generated commands in $(CURSOR_DST)/ and $(CLAUDE_DST)/"

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

test-supervisor: setup-venv ## Run tests for supervisor/main workspace only
	@echo "Running main workspace tests..."
	@. .venv/bin/activate && uv add pytest-asyncio --group unittest
	@echo "Running general project tests..."
	@. .venv/bin/activate && PYTHONPATH=. uv run pytest --ignore=integration \
		--ignore=ai_platform_engineering/knowledge_bases/rag/tests \
		--ignore=ai_platform_engineering/agents \
		--ignore=ai_platform_engineering/multi_agents/tests \
		--ignore=volumes --ignore=docker-compose

## ========== Individual MCP Tests ==========

test-mcp-argocd: ## Run ArgoCD MCP tests
	@echo "Running ArgoCD MCP tests..."
	@cd ai_platform_engineering/agents/argocd/mcp && $(MAKE) test

test-agent-argocd: setup-venv ## Run ArgoCD agent unit tests
	@echo "Running ArgoCD agent unit tests..."
	@echo "Installing ArgoCD agent..."
	@. .venv/bin/activate && uv add ai_platform_engineering/agents/argocd --dev
	@. .venv/bin/activate && PYTHONPATH=. uv run pytest ai_platform_engineering/agents/argocd/tests/ -v

test-mcp-backstage: ## Run Backstage MCP tests
	@echo "Running Backstage MCP tests..."
	@cd ai_platform_engineering/agents/backstage/mcp && $(MAKE) test

test-mcp-confluence: ## Run Confluence MCP tests
	@echo "Running Confluence MCP tests..."
	@cd ai_platform_engineering/agents/confluence/mcp && $(MAKE) test

test-mcp-jira: ## Run Jira MCP tests
	@echo "Running Jira MCP tests..."
	@cd ai_platform_engineering/agents/jira/mcp && $(MAKE) test

test-mcp-komodor: ## Run Komodor MCP tests
	@echo "Running Komodor MCP tests..."
	@cd ai_platform_engineering/agents/komodor/mcp && $(MAKE) test

test-mcp-pagerduty: ## Run PagerDuty MCP tests
	@echo "Running PagerDuty MCP tests..."
	@cd ai_platform_engineering/agents/pagerduty/mcp && $(MAKE) test

test-mcp-slack: ## Slack MCP is external (korotovsky/slack-mcp-server) - no local tests
	@echo "Slack uses the external OSS korotovsky/slack-mcp-server. No local MCP tests."

test-mcp-splunk: ## Run Splunk MCP tests
	@echo "Running Splunk MCP tests..."
	@cd ai_platform_engineering/agents/splunk/mcp && $(MAKE) test

test-agents: test-mcp-argocd test-mcp-jira ## Run tests for all agents (in their own environments)
	@echo ""
	@echo "Skipping RAG module tests (temporarily disabled)..."
	@echo "✓ RAG tests skipped"

test: test-supervisor test-multi-agents test-agents ## Run all tests (supervisor + multi-agents + agents)

## ========== Multi-Agent Tests ==========

test-multi-agents: setup-venv ## Run multi-agent system tests
	@echo "Running multi-agent system tests..."
	@. .venv/bin/activate && uv run pytest ai_platform_engineering/multi_agents/tests/ -v
	@echo "Running platform engineer executor tests..."
	@. .venv/bin/activate && uv run pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ -v

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

## ========== Slack Streaming Conformance ==========

test-slack-stream: setup-venv ## Run a single Slack streaming query (requires running supervisor). Usage: make test-slack-stream QUERY="what is agntcy"
	@echo "Running Slack streaming simulator..."
	@PYTHONPATH=. uv run python tests/simulate_slack_stream.py "$${QUERY:-what is agntcy}" -v

test-slack-conformance: setup-venv ## Run full Slack streaming conformance suite with report (requires running supervisor)
	@echo "Running Slack streaming conformance suite..."
	@mkdir -p tests/reports
	@PYTHONPATH=. uv run python tests/simulate_slack_stream.py --suite --report tests/reports/conformance-report.md -v
	@echo "✓ Report saved to tests/reports/conformance-report.md"

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

## ========== Beads Issue Tracking ==========

beads-gh-issues-sync: ## Sync beads issues to GitHub Issues (dry-run by default)
	@echo "Syncing beads to GitHub Issues..."
	@./scripts/sync_beads_to_github.sh --dry-run

beads-gh-issues-sync-run: ## Actually sync beads to GitHub Issues (creates issues)
	@echo "Syncing beads to GitHub Issues (LIVE)..."
	@./scripts/sync_beads_to_github.sh

beads-list: ## List all beads issues
	@bd list

beads-ready: ## Show beads ready for work
	@bd ready

beads-sync: ## Sync beads with git
	@bd sync

## ========== Release & Versioning ==========
release: setup-venv  ## Bump version and create a release
	@uv tool install commitizen
	@git tag -d stable || echo "No stable tag found."
	@cz changelog
	@git add CHANGELOG.md
	@git commit -m "docs: update changelog"
	@cz bump --increment $${INCREMENT:-PATCH}
	@echo "Version bumped updated successfully."

## ========== Helm Docs ==========

check-helm-docs: ## Check that helm-docs is installed (prints install instructions if missing)
	@if ! which helm-docs > /dev/null 2>&1; then \
		echo ""; \
		echo "helm-docs is not installed. Install it with one of:"; \
		echo ""; \
		echo "  macOS / Linux (Homebrew):"; \
		echo "    brew install helm-docs"; \
		echo ""; \
		echo "  Any platform (Go):"; \
		echo "    go install github.com/norwoodj/helm-docs/cmd/helm-docs@latest"; \
		echo ""; \
		echo "  Binary download (Linux / macOS / Windows):"; \
		echo "    https://github.com/norwoodj/helm-docs/releases"; \
		echo ""; \
		exit 1; \
	fi

helm-docs: check-helm-docs ## Regenerate Helm chart README.md files from values.yaml comments
	@echo "Generating Helm chart documentation..."
	@helm-docs --chart-search-root charts/
	@echo "✓ Helm chart documentation updated"

## ========== Helm Chart Docs Generator ==========

check-yq: ## Check that yq is installed (prints install instructions if missing)
	@if ! which yq > /dev/null 2>&1; then \
		echo ""; \
		echo "yq is not installed. Install it with one of:"; \
		echo ""; \
		echo "  macOS / Linux (Homebrew):"; \
		echo "    brew install yq"; \
		echo ""; \
		echo "  Any platform (Go):"; \
		echo "    go install github.com/mikefarah/yq/v4@latest"; \
		echo ""; \
		echo "  Binary download:"; \
		echo "    https://github.com/mikefarah/yq/releases"; \
		echo ""; \
		exit 1; \
	fi

docs-helm-charts: check-yq check-helm-docs ## Generate Helm chart documentation (READMEs + Docusaurus pages)
	@echo "Generating Helm chart documentation..."
	@CHART_VERSION=$(CHART_VERSION) ./scripts/generate-helm-chart-docs.sh
	@echo "✓ Helm chart documentation generated"

docs-helm-validate: docs-helm-charts docs-build ## End-to-end validation: generate docs + Docusaurus build + RC check
	@echo "Checking for RC version patterns in generated docs..."
	@if grep -rE '-(rc|alpha|beta|pre)\.' docs/docs/installation/helm-charts/ 2>/dev/null; then \
		echo "FAIL: RC version patterns found in generated docs"; \
		exit 1; \
	fi
	@echo "✓ Helm chart docs validation passed"

## ========== Security Scanning ==========

IMAGE_TAG ?= localtag

GRYPE_SEVERITY ?= high

scan-images: ## Scan all locally built images with grype (make scan-images GRYPE_SEVERITY=high)
	@command -v grype >/dev/null 2>&1 || { echo "grype not found. Install: brew install grype"; exit 1; }
	@echo "Scanning images with grype (severity >= $(GRYPE_SEVERITY))..."
	@failed=0; \
	for img in $$(docker images --format "{{.Repository}}:{{.Tag}}" | grep "cnoe-io.*$(IMAGE_TAG)"); do \
		echo ""; \
		echo "=== $$img ==="; \
		grype "$$img" --fail-on "$(GRYPE_SEVERITY)" --quiet 2>/dev/null || failed=1; \
	done; \
	if [ "$$failed" -eq 1 ]; then \
		echo ""; \
		echo "FAIL: one or more images have vulnerabilities >= $(GRYPE_SEVERITY)"; \
		exit 1; \
	else \
		echo ""; \
		echo "✓ All images passed grype scan"; \
	fi

scan-image: ## Scan a single image with grype (make scan-image IMG=ghcr.io/cnoe-io/mcp-splunk:localtag)
	@command -v grype >/dev/null 2>&1 || { echo "grype not found. Install: brew install grype"; exit 1; }
	@[ -n "$(IMG)" ] || { echo "Usage: make scan-image IMG=<image:tag>"; exit 1; }
	@grype "$(IMG)" --fail-on "$(GRYPE_SEVERITY)"

## ========== Comprehensive RBAC tests (spec 102) ==========
# See docs/docs/specs/102-comprehensive-rbac-tests-and-completion/quickstart.md

# Profile selection. Override with E2E_PROFILES=...
# All profiles live in docker-compose.dev.yaml — no separate e2e compose file.
E2E_PROFILES   ?= rbac,caipe-ui,caipe-supervisor,caipe-mongodb,dynamic-agents,rag,all-agents,slack-bot
E2E_COMPOSE    := -f docker-compose.dev.yaml
E2E_KC_URL     ?= http://localhost:7080
E2E_KC_REALM   ?= cnoe
E2E_KC_RESOURCE_SERVER_ID ?= caipe-resource-server
E2E_WAIT_SECS  ?= 120
RBAC_PYTEST_DIRS ?= tests/rbac/unit/py tests/rbac/fixtures
RBAC_E2E_DIRS    ?= tests/rbac/e2e

# E2E port band — host-side ports for the e2e lane. Container ports unchanged.
# caipe-ui MUST stay on 3000 because Keycloak's caipe-ui client only allow-lists
# http://localhost:3000/* as a redirect URI (see deploy/keycloak/realm-config.json).
# Mongo + supervisor move to the 28xxx band to avoid collisions with a host-side
# Mongo on 27017 and an in-stack agent-splunk that publishes 8010.
E2E_MONGODB_HOST_PORT    ?= 28017
E2E_SUPERVISOR_HOST_PORT ?= 28000

# E2E env injected into docker-compose.dev.yaml via ${VAR:-default} substitution.
# These are no-ops for `make test-up` (dev) — they only activate the e2e behavior
# when the test-rbac-* targets export them.
E2E_COMPOSE_ENV := \
  E2E_RUN=true \
  MONGODB_HOST_PORT=$(E2E_MONGODB_HOST_PORT) \
  SUPERVISOR_HOST_PORT=$(E2E_SUPERVISOR_HOST_PORT) \
  RBAC_FALLBACK_FILE=$(CURDIR)/deploy/keycloak/realm-config-extras.json \
  RBAC_FALLBACK_CONFIG_PATH=/etc/keycloak/realm-config-extras.json

.PHONY: test-rbac test-rbac-lint test-rbac-up test-rbac-down test-rbac-jest test-rbac-pytest test-rbac-e2e

test-rbac-lint: ## Lint the RBAC matrix + realm-config-extras (T009/T011/T012). No services required.
	@echo "[test-rbac-lint] running matrix linter (T009)…"
	@if [ "$(RBAC_LINT_STRICT)" = "1" ]; then \
	   PYTHONPATH=. uv run python scripts/validate-rbac-matrix.py; \
	 else \
	   PYTHONPATH=. uv run python scripts/validate-rbac-matrix.py || \
	     echo "[test-rbac-lint] matrix lint failed (expected during phase rollout — set RBAC_LINT_STRICT=1 to hard-fail)"; \
	 fi
	@echo "[test-rbac-lint] running realm-config + extras validator (T011/T012)…"
	@PYTHONPATH=. uv run python scripts/validate-realm-config.py
	@echo "[test-rbac-lint] running requireAdmin deprecation guard (T051)…"
	@if [ "$(RBAC_LINT_STRICT)" = "1" ]; then \
	   STRICT=1 bash scripts/check-no-new-requireAdmin.sh; \
	 else \
	   bash scripts/check-no-new-requireAdmin.sh || \
	     echo "[test-rbac-lint] requireAdmin guard reported drift — set RBAC_LINT_STRICT=1 to hard-fail"; \
	 fi

test-rbac-up: ## Boot the e2e stack (Keycloak + UI + supervisor + agents + mongo) and seed personas via init-idp.sh.
	@echo "[test-rbac-up] starting stack with profiles: $(E2E_PROFILES)"
	@echo "[test-rbac-up] e2e ports: ui=3000 (IdP-pinned) supervisor=$(E2E_SUPERVISOR_HOST_PORT) mongo=$(E2E_MONGODB_HOST_PORT) keycloak=7080"
	@$(E2E_COMPOSE_ENV) COMPOSE_PROFILES='$(E2E_PROFILES)' \
	   docker compose $(E2E_COMPOSE) up -d --wait --wait-timeout $(E2E_WAIT_SECS)
	@echo "[test-rbac-up] waiting for Keycloak readiness on $(E2E_KC_URL)…"
	@for i in $$(seq 1 60); do \
	   if curl -fsS $(E2E_KC_URL)/realms/master/.well-known/openid-configuration >/dev/null 2>&1; then \
	     echo "[test-rbac-up] Keycloak is up"; break; \
	   fi; \
	   sleep 2; \
	   if [ $$i -eq 60 ]; then echo "[test-rbac-up] FAIL: Keycloak never became ready"; exit 1; fi; \
	 done
	@echo "[test-rbac-up] running init-idp.sh to seed realm + personas…"
	@KEYCLOAK_URL=$(E2E_KC_URL) KEYCLOAK_REALM=$(E2E_KC_REALM) bash deploy/keycloak/init-idp.sh
	@echo "[test-rbac-up] stack is ready. KEYCLOAK_URL=$(E2E_KC_URL) KEYCLOAK_REALM=$(E2E_KC_REALM)"

test-rbac-down: ## Tear down the e2e stack (volumes removed).
	@echo "[test-rbac-down] tearing down e2e stack…"
	@$(E2E_COMPOSE_ENV) COMPOSE_PROFILES='$(E2E_PROFILES)' \
	   docker compose $(E2E_COMPOSE) down -v --remove-orphans

test-rbac-pytest: ## Run RBAC pytest helper-unit + matrix-driver tests. Pass --rbac-online via PYTEST_ARGS to enable live-Keycloak tests.
	@echo "[test-rbac-pytest] running RBAC pytest suite ($(RBAC_PYTEST_DIRS))…"
	@mkdir -p test-results
	@PYTHONPATH=. \
	   KEYCLOAK_URL=$(E2E_KC_URL) \
	   KEYCLOAK_REALM=$(E2E_KC_REALM) \
	   KEYCLOAK_RESOURCE_SERVER_ID=$(E2E_KC_RESOURCE_SERVER_ID) \
	   uv run pytest $(RBAC_PYTEST_DIRS) -v \
	     --junitxml=test-results/rbac-pytest.xml \
	     $(PYTEST_ARGS)

test-rbac-jest: ## Run RBAC Jest matrix-driver tests (TS helper parity + UI BFF). Emits ui/test-results/junit.xml for T058 to consume.
	@if [ -d ui ] && [ -f ui/package.json ]; then \
	   echo "[test-rbac-jest] running ui/ jest suite filtered to rbac…"; \
	   mkdir -p ui/test-results; \
	   cd ui && JEST_JUNIT_OUTPUT_DIR=test-results JEST_JUNIT_OUTPUT_NAME=junit.xml \
	     npx jest \
	       'src/__tests__/rbac-matrix-driver.test.ts' \
	       'src/lib/rbac/__tests__/' \
	       'src/app/api/__tests__/rag-rbac.test.ts' \
	       --reporters=default --reporters=jest-junit \
	       --passWithNoTests; \
	 else \
	   echo "[test-rbac-jest] ui/ not found; skipping jest stage"; \
	 fi

test-rbac-e2e: ## Run RBAC Playwright e2e suite (tests/rbac/e2e/). Requires `make test-rbac-up` first.
	@if [ -d tests/rbac/e2e ] && [ -f tests/rbac/e2e/package.json ]; then \
	   echo "[test-rbac-e2e] running playwright RBAC e2e tests from tests/rbac/e2e/…"; \
	   if [ ! -d tests/rbac/e2e/node_modules ]; then \
	     echo "[test-rbac-e2e] installing tests/rbac/e2e/node_modules (one-time)…"; \
	     cd tests/rbac/e2e && npm install --no-audit --no-fund; cd $(CURDIR); \
	   fi; \
	   cd tests/rbac/e2e && npx playwright test --grep @rbac; \
	 else \
	   echo "[test-rbac-e2e] tests/rbac/e2e/ not found; skipping"; \
	 fi

test-rbac: ## Full comprehensive RBAC suite: lint + (optional online stack) + pytest + jest + e2e.
	@$(MAKE) test-rbac-lint
	@$(MAKE) test-rbac-pytest
	@$(MAKE) test-rbac-jest
	@if [ "$(RBAC_E2E)" = "1" ]; then \
	   echo "[test-rbac] RBAC_E2E=1 — bringing up stack and running playwright"; \
	   $(MAKE) test-rbac-up && $(MAKE) test-rbac-e2e || RC=$$?; \
	   $(MAKE) test-rbac-down; \
	   exit $${RC:-0}; \
	 else \
	   echo "[test-rbac] skipping e2e stage (set RBAC_E2E=1 to enable)"; \
	 fi

## ========== Help ==========

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' | sort