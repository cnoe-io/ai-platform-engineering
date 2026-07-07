# syntax=docker/dockerfile:1.7
# tome-agent — Claude Agent SDK ingest/chat service, exposed over HTTP/SSE.
#
# Multi-project: TTT_PROJECT_ROOT is the base dir; the service appends
# /<project_id> per request. Carries no ambient connector tokens — caipe-ui
# forwards the requesting user's OAuth credentials per-request.
#
# The Claude Agent SDK ships a standalone (Bun-compiled, glibc) `claude` binary
# inside the package, so the base must be glibc (Debian slim), NOT musl/alpine.

FROM python:3.12-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir uv
# Resolve deps from the lockfile (this pulls claude-agent-sdk, which provides
# the bundled platform-native `claude` CLI binary).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY tome_agent ./tome_agent

FROM python:3.12-slim
WORKDIR /app

# The bundled Claude CLI writes config/state under $HOME on its `initialize`
# handshake; without a writable HOME the handshake hangs and the SDK's
# initialize control request times out. Give the runtime user a writable home.
RUN useradd --create-home --uid 1001 agent \
    && mkdir -p /home/agent/.claude /project \
    && chown -R agent:agent /home/agent /project

COPY --from=builder --chown=agent:agent /app /app

ENV PYTHONPATH=/app \
    HOME=/home/agent \
    TTT_PROJECT_ROOT=/project \
    PATH=/app/.venv/bin:$PATH

# /project is the per-request wiki working tree base. The service rehydrates
# project state from the backend, so this can be an ephemeral volume.
VOLUME ["/project"]

USER agent
EXPOSE 8766
CMD ["/app/.venv/bin/uvicorn", "tome_agent.agent.main:app", "--host", "0.0.0.0", "--port", "8766"]
