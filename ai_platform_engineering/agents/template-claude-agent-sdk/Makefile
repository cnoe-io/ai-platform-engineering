# Petstore Agent Standalone Makefile

# Variables
AGENT_NAME := petstore
AGENT_DIR_NAME := petstore-agent-claude-sdk
CONTAINER_NAME := $(AGENT_DIR_NAME)
IMAGE_NAME := $(AGENT_DIR_NAME):latest
HOST_PORT := 8000
CONTAINER_PORT := 8000
ENV_FILE := ../../../.env

# Include common functionality
include ../common.mk

run-a2a: setup-venv check-env uv-sync ## Run A2A agent with uvicorn
	uv run python -m $(AGENT_PKG_NAME) --host 0.0.0.0 --port $${A2A_PORT:-8000}
	
# Docker build and run settings
DOCKERFILE := build/Dockerfile.a2a
VOLUMES := -v $(PWD)/agent_petstore:/app/agent_petstore \
           -v $(PWD)/clients:/app/clients \
           -v $(PWD)/$(ENV_FILE):/app/.env \
           -v /var/run/docker.sock:/var/run/docker.sock

ENVIRONMENT := -e A2A_TRANSPORT=p2p \
               -e MCP_MODE=http \
               -e MCP_PORT=$(CONTAINER_PORT) \
               -e MCP_HOST=mcp-petstore \
               -e ENABLE_TRACING=false

# Default target
.PHONY: help
help:
	@echo "Petstore Agent Standalone Commands:"
	@echo "  build         - Build the petstore agent Docker image"
	@echo "  run           - Run attached (smart: uses cache, builds only if needed)"
	@echo "  run-rebuild   - Force rebuild and run (like old behavior)"
	@echo "  run-detached  - Run in background on port $(HOST_PORT)"
	@echo "  stop          - Stop the running petstore agent container"
	@echo "  restart       - Stop and restart the petstore agent"
	@echo "  logs          - Show logs from the running container (detached mode only)"
	@echo "  shell         - Open a shell in the running container"
	@echo "  clean         - Stop container and remove image"
	@echo "  status        - Show container status"
	@echo "  rebuild       - Clean build (remove image and rebuild)"

# Build the Docker image
.PHONY: build
build:
	@echo "Building petstore agent image..."
	docker build -t $(IMAGE_NAME) -f $(DOCKERFILE) $$(git rev-parse --show-toplevel 2>/dev/null || echo "../..")

# Run the container (attached mode - like docker compose up)
.PHONY: run
run: _ensure_image
	@echo "Starting petstore agent on port $(HOST_PORT)..."
	@docker stop $(CONTAINER_NAME) 2>/dev/null || true
	@docker rm $(CONTAINER_NAME) 2>/dev/null || true
	@echo "Petstore agent running at http://localhost:$(HOST_PORT)"
	@echo "Press Ctrl+C to stop"
	docker run --rm \
		--name $(CONTAINER_NAME) \
		-p $(HOST_PORT):$(CONTAINER_PORT) \
		$(VOLUMES) \
		$(ENVIRONMENT) \
		$(IMAGE_NAME)

# Run the container in detached mode (background)
.PHONY: run-detached
run-detached: _ensure_image
	@echo "Starting petstore agent on port $(HOST_PORT) in background..."
	@docker stop $(CONTAINER_NAME) 2>/dev/null || true
	@docker rm $(CONTAINER_NAME) 2>/dev/null || true
	docker run -d \
		--name $(CONTAINER_NAME) \
		-p $(HOST_PORT):$(CONTAINER_PORT) \
		$(VOLUMES) \
		$(ENVIRONMENT) \
		$(IMAGE_NAME)
	@echo "Petstore agent started at http://localhost:$(HOST_PORT)"
	@echo "Use 'make logs' to see output or 'make stop' to stop"

# Force rebuild and run (like old behavior)
.PHONY: run-rebuild
run-rebuild: build run-no-build

# Internal: Run without building (for use after build)
.PHONY: run-no-build
run-no-build:
	@echo "Starting petstore agent on port $(HOST_PORT)..."
	@docker stop $(CONTAINER_NAME) 2>/dev/null || true
	@docker rm $(CONTAINER_NAME) 2>/dev/null || true
	@echo "Petstore agent running at http://localhost:$(HOST_PORT)"
	@echo "Press Ctrl+C to stop"
	docker run --rm \
		--name $(CONTAINER_NAME) \
		-p $(HOST_PORT):$(CONTAINER_PORT) \
		$(VOLUMES) \
		$(ENVIRONMENT) \
		$(IMAGE_NAME)

# Internal: Ensure image exists, build only if needed
.PHONY: _ensure_image
_ensure_image:
	@if ! docker image inspect $(IMAGE_NAME) >/dev/null 2>&1; then \
		echo "Image $(IMAGE_NAME) not found, building..."; \
		$(MAKE) build; \
	else \
		echo "Using existing image $(IMAGE_NAME) (use 'make run-rebuild' to force rebuild)"; \
	fi

# Stop the container
.PHONY: stop
stop:
	@echo "Stopping petstore agent..."
	@docker stop $(CONTAINER_NAME) 2>/dev/null || echo "Container not running"
	@docker rm $(CONTAINER_NAME) 2>/dev/null || echo "Container not found"

# Restart the container (smart - uses existing image)
.PHONY: restart
restart: stop run

# Restart with rebuild (force fresh image)
.PHONY: restart-rebuild
restart-rebuild: stop run-rebuild

# Show logs
.PHONY: logs
logs:
	@echo "Showing logs for $(CONTAINER_NAME)..."
	docker logs -f $(CONTAINER_NAME)

# Open shell in container
.PHONY: shell
shell:
	@echo "Opening shell in $(CONTAINER_NAME)..."
	docker exec -it $(CONTAINER_NAME) /bin/bash

# Show container status
.PHONY: status
status:
	@echo "Container status:"
	@docker ps -a --filter name=$(CONTAINER_NAME) --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"

# Clean up
.PHONY: clean
clean: stop
	@echo "Removing petstore agent image..."
	@docker rmi $(IMAGE_NAME) 2>/dev/null || echo "Image not found"

# Rebuild from scratch
.PHONY: rebuild
rebuild: clean build

# Quick development cycle (smart cache, attached mode)
.PHONY: dev
dev: stop run

# Development cycle with forced rebuild
.PHONY: dev-rebuild
dev-rebuild: stop run-rebuild

# Check if .env file exists
.PHONY: check-env
check-env:
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "Error: .env file not found at $(ENV_FILE)"; \
		echo "Please create the .env file with required environment variables:"; \
		echo "  MCP_API_URL=https://petstore.swagger.io/v2"; \
		echo "  MCP_API_KEY=your_api_key_here"; \
		exit 1; \
	fi

# Health check
.PHONY: health
health:
	@echo "Checking petstore agent health..."
	@curl -s http://localhost:$(HOST_PORT)/.well-known/agent.json | jq . || echo "Agent not responding"

# Run with environment check
run-safe: check-env run

# Show environment variables that will be used
.PHONY: show-env
show-env:
	@echo "Environment variables that will be set:"
	@echo "  A2A_TRANSPORT=p2p"
	@echo "  MCP_MODE=http"
	@echo "  MCP_PORT=$(CONTAINER_PORT)"
	@echo "  MCP_HOST=mcp-petstore"
	@echo "  ENABLE_TRACING=false"
	@echo ""
	@echo "Volumes that will be mounted (live code changes):"
	@echo "  $(PWD)/agent_petstore -> /app/agent_petstore"
	@echo "  $(PWD)/clients -> /app/clients"
	@echo "  $(PWD)/$(ENV_FILE) -> /app/.env"
	@echo "  /var/run/docker.sock -> /var/run/docker.sock"
	@echo ""
	@echo "Port mapping: $(HOST_PORT):$(CONTAINER_PORT)"
	@echo ""
	@echo "📝 Note: Code changes are reflected immediately via volume mounts"
	@echo "   Use 'make run' for smart caching or 'make run-rebuild' to force rebuild"
