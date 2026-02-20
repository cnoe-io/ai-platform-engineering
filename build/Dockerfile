# ---------- Stage 0: Go toolchain (for github-mcp-server STDIO) ----------
FROM golang:1.24-bookworm AS golang

# ---------- Stage 1: Build dependencies ----------
FROM python:3.13-slim AS builder

# Install system dependencies and uv in one layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    git \
    && pip install uv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the entire project structure first since uv sync needs it to build
COPY --chown=root:root . /app/

# Install dependencies into venv (no dev deps) using committed lock file
# --locked ensures we use the existing uv.lock without modification
# Increase timeout for large packages (e.g., pyarrow 39MB)
RUN --mount=type=cache,target=/root/.cache/uv \
    UV_HTTP_TIMEOUT=300 uv sync --locked --no-dev

# ---------- Stage 2: Final runtime image ----------
FROM python:3.13-slim

# Install only runtime dependencies (including uv for MCP STDIO subprocess execution)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget \
    curl \
    grep \
    && pip install uv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Go toolchain — needed at runtime by github-mcp-server (go run via STDIO)
COPY --from=golang /usr/local/go /usr/local/go

# Create appuser in final image
RUN groupadd -r appuser && useradd -r -g appuser -u 1001 -m appuser

WORKDIR /app

# Set env vars for uv & PATH
# PYTHONPATH includes all agent directories so that imports like 'from agent_github.tools'
# work in both single-node (unified container) and multi-node (standalone container) modes
ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    GOPATH="/home/appuser/go" \
    PATH="/app/.venv/bin:/usr/local/go/bin:/home/appuser/go/bin:${PATH}" \
    PYTHONPATH="/app/ai_platform_engineering/agents/github:/app/ai_platform_engineering/agents/backstage:/app/ai_platform_engineering/agents/jira:/app/ai_platform_engineering/agents/webex:/app/ai_platform_engineering/agents/argocd:/app/ai_platform_engineering/agents/aigateway:/app/ai_platform_engineering/agents/pagerduty:/app/ai_platform_engineering/agents/slack:/app/ai_platform_engineering/agents/splunk:/app/ai_platform_engineering/agents/komodor:/app/ai_platform_engineering/agents/confluence:/app/ai_platform_engineering/agents/aws:${PYTHONPATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Copy venv & code from builder
COPY --from=builder --chown=appuser:appuser /app /app

USER appuser

EXPOSE 8000

ENTRYPOINT [ "python", "-m", "ai_platform_engineering.multi_agents" ]
