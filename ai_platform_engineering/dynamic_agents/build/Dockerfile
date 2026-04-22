# Dynamic Agents Service Dockerfile
# Two-stage build for secure, minimal production image

# =============================================================================
# Stage 1: Builder - Install dependencies with uv
# =============================================================================
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# Use system Python (same version as final image)
ENV UV_PYTHON_DOWNLOADS=0

WORKDIR /app/dynamic_agents

# Install dependencies first (cached layer)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    UV_HTTP_TIMEOUT=300 uv sync --locked --no-install-project --no-dev

# Copy source code and install project
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    UV_HTTP_TIMEOUT=300 uv sync --locked --no-dev

# Patch langchain_aws ChatBedrock._as_converse to forward base_model_id to
# ChatBedrockConverse. Without this, switching to the Converse API (e.g. when
# beta_use_converse_api=True) creates a new ChatBedrockConverse without base_model_id,
# triggering a GetInferenceProfile API call that fails when the IAM role only
# grants bedrock:InvokeModel / bedrock-runtime:Converse on the AIP ARN.
# Remove this patch once langchain-aws fixes _as_converse to forward base_model_id.
RUN BEDROCK_PY=".venv/lib/python3.13/site-packages/langchain_aws/chat_models/bedrock.py" && \
    grep -q 'guardrail_config=(self.guardrails if self._guardrails_enabled else None),  # type: ignore\[call-arg\]' "$BEDROCK_PY" || \
        { echo "ERROR: langchain_aws patch target not found — upstream may have changed. Review dynamic_agents/build/Dockerfile patch."; exit 1; } && \
    sed -i 's/guardrail_config=(self.guardrails if self._guardrails_enabled else None),  # type: ignore\[call-arg\]/guardrail_config=(self.guardrails if self._guardrails_enabled else None),  # type: ignore[call-arg]\n            base_model_id=self.base_model_id,/' "$BEDROCK_PY" && \
    grep -q 'base_model_id=self.base_model_id,' "$BEDROCK_PY" || \
        { echo "ERROR: langchain_aws patch was not applied — sed substitution had no effect."; exit 1; }

# Cleanup to reduce image size (~50-100MB savings)
RUN find /app/dynamic_agents/.venv -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true && \
    find /app/dynamic_agents/.venv -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true && \
    find /app/dynamic_agents/.venv -type d -name "test" -exec rm -rf {} + 2>/dev/null || true && \
    find /app/dynamic_agents/.venv -name "*.pyc" -delete 2>/dev/null || true && \
    find /app/dynamic_agents/.venv -name "*.pyi" -delete 2>/dev/null || true && \
    find /app/dynamic_agents/.venv -type d -name "include" -path "*/site-packages/*" -exec rm -rf {} + 2>/dev/null || true

# =============================================================================
# Stage 2: Runtime - Minimal secure image
# =============================================================================
FROM python:3.13-slim-bookworm

# Create non-root user (UID/GID 1001 for Kubernetes compatibility)
RUN groupadd --gid 1001 app && \
    useradd --uid 1001 --gid app --shell /bin/bash --create-home app

# Copy application from builder
COPY --from=builder --chown=app:app /app /app

WORKDIR /app/dynamic_agents

# Add virtual environment to PATH
ENV PATH="/app/dynamic_agents/.venv/bin:$PATH"

# Run as non-root user
USER app

# Default port (configurable via PORT env var)
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')" || exit 1

# Run the application
CMD ["python3", "src/dynamic_agents/main.py"]
