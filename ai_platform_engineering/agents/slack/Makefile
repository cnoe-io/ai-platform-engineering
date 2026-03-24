# Slack Agent Makefile
# --------------------------------------------------
# This Makefile includes common functionality and adds Slack-specific targets.
# The Slack agent uses the OSS korotovsky/slack-mcp-server instead of a
# custom in-tree MCP server, so run-a2a and run-mcp are overridden.
# --------------------------------------------------

# Agent-specific variables
AGENT_NAME = slack

# Include common functionality
include ../common.mk

# Additional PHONY targets specific to this agent
.PHONY: slack-specific-target

## ========== Slack-Specific Targets ==========

slack-specific-target: ## Example slack-specific target
	@echo "This is a Slack-specific target"
	@echo "Agent: $(AGENT_NAME)"
	@echo "Package: $(AGENT_PKG_NAME)"

# Override run-a2a: no local ./mcp directory (uses OSS korotovsky/slack-mcp-server)
run-a2a: setup-venv check-env uv-sync ## Run A2A agent (MCP server is external)
	export PYTHONPATH=$(REPO_ROOT):$$PYTHONPATH; \
	uv run python -m $(AGENT_PKG_NAME) --host 0.0.0.0 --port $${A2A_PORT:-8000}

# Override run-mcp: the MCP server is now an external Docker image
run-mcp: ## Run OSS Slack MCP server via Docker
	@echo "Slack uses the OSS korotovsky/slack-mcp-server."
	@echo "Run it via Docker:"
	@echo "  docker run -p 3001:3001 -e SLACK_MCP_HOST=0.0.0.0 -e SLACK_MCP_PORT=3001 -e SLACK_MCP_XOXB_TOKEN=\$$SLACK_BOT_TOKEN -e SLACK_MCP_ADD_MESSAGE_TOOL=true ghcr.io/korotovsky/slack-mcp-server:v1.2.3 --transport http"

# Override run-docker-a2a to include Slack-specific environment variables
run-docker-a2a: ## Run the A2A agent in Docker with Slack-specific env vars
	@$(MAKE) check-env
	@AGENT_ID=$$(grep CNOE_AGENT_$$(echo $(AGENT_NAME) | tr a-z A-Z)_ID .env | cut -d '=' -f2 | tr -d '"'); \
	AGENT_PORT=$$(grep A2A_AGENT_PORT .env | cut -d '=' -f2 | tr -d '"'); \
	A2A_AGENT_IMAGE=$$(grep A2A_AGENT_IMAGE .env | cut -d '=' -f2 || echo ""); \
	AZURE_OPENAI_ENDPOINT=$$(grep AZURE_OPENAI_ENDPOINT .env | cut -d '=' -f2 | tr -d '"'); \
	AZURE_OPENAI_DEPLOYMENT=$$(grep AZURE_OPENAI_DEPLOYMENT .env | cut -d '=' -f2 | tr -d '"'); \
	AZURE_OPENAI_API_KEY=$$(grep AZURE_OPENAI_API_KEY .env | cut -d '=' -f2 | tr -d '"'); \
	AZURE_OPENAI_API_VERSION=$$(grep AZURE_OPENAI_API_VERSION .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_BOT_TOKEN=$$(grep SLACK_BOT_TOKEN .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_APP_TOKEN=$$(grep SLACK_APP_TOKEN .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_SIGNING_SECRET=$$(grep SLACK_SIGNING_SECRET .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_CLIENT_SECRET=$$(grep SLACK_CLIENT_SECRET .env | cut -d '=' -f2 | tr -d '"'); \
	SLACK_TEAM_ID=$$(grep SLACK_TEAM_ID .env | cut -d '=' -f2 | tr -d '"'); \
	LOCAL_AGENT_PORT=$${AGENT_PORT:-8000}; \
	LOCAL_AGENT_IMAGE=$${A2A_AGENT_IMAGE:-ghcr.io/cnoe-io/$(AGENT_DIR_NAME):a2a-latest}; \
	echo "========================================================================"; \
	echo "==                     A2A AGENT DOCKER RUN                           =="; \
	echo "========================================================================"; \
	echo "Using Agent Image : $$LOCAL_AGENT_IMAGE"; \
	echo "Using Agent ID    : $$AGENT_ID"; \
	echo "Using Agent Port  : localhost:$$LOCAL_AGENT_PORT"; \
	echo "========================================================================"; \
	echo "==               Do not use uvicorn port in the logs                  =="; \
	echo "========================================================================"; \
	docker run -p $$LOCAL_AGENT_PORT:8000 -it \
		-v $(PWD)/.env:/opt/agent_src/.env \
		-v $(PWD)/a2a-python:/opt/agent_src/a2a-python \
		--env-file .env \
		-e AGENT_ID=$$AGENT_ID \
		-e AIOHTTP_CLIENT_MAX_REDIRECTS=10 \
		-e AIOHTTP_CLIENT_TIMEOUT=60 \
		-e API_HOST=0.0.0.0 \
		-e API_URL="http://localhost:$$LOCAL_AGENT_PORT" \
		-e AZURE_OPENAI_ENDPOINT="$$AZURE_OPENAI_ENDPOINT" \
		-e AZURE_OPENAI_DEPLOYMENT="$$AZURE_OPENAI_DEPLOYMENT" \
		-e AZURE_OPENAI_API_KEY="$$AZURE_OPENAI_API_KEY" \
		-e AZURE_OPENAI_API_VERSION="$$AZURE_OPENAI_API_VERSION" \
		-e SLACK_BOT_TOKEN="$$SLACK_BOT_TOKEN" \
		-e SLACK_APP_TOKEN="$$SLACK_APP_TOKEN" \
		-e SLACK_SIGNING_SECRET="$$SLACK_SIGNING_SECRET" \
		-e SLACK_CLIENT_SECRET="$$SLACK_CLIENT_SECRET" \
		-e SLACK_TEAM_ID="$$SLACK_TEAM_ID" \
		$$LOCAL_AGENT_IMAGE
