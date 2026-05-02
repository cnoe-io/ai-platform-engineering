# caipe-scheduler — cron schedule registry + k8s CronJob orchestrator
# Two-stage build for a minimal, hardened production image.

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0

WORKDIR /app/scheduler

# Lockless build: pyproject.toml is the source of truth. We do not commit a
# uv.lock for this service yet — keeps the dep surface small and easy to audit.
COPY pyproject.toml ./
RUN --mount=type=cache,target=/root/.cache/uv \
    UV_HTTP_TIMEOUT=300 uv sync --no-dev --no-install-project

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    UV_HTTP_TIMEOUT=300 uv sync --no-dev

# Strip caches and tests from the venv to slim the runtime image.
RUN find /app/scheduler/.venv -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true && \
    find /app/scheduler/.venv -type d -name tests -exec rm -rf {} + 2>/dev/null || true && \
    find /app/scheduler/.venv -type d -name test  -exec rm -rf {} + 2>/dev/null || true && \
    find /app/scheduler/.venv -name "*.pyc"       -delete 2>/dev/null || true

# =============================================================================
# Stage 2: Runtime
# =============================================================================
FROM python:3.13-slim-bookworm

RUN apt-get update && apt-get upgrade -y --no-install-recommends \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 app && \
    useradd --uid 1001 --gid app --shell /bin/bash --create-home app

COPY --from=builder --chown=app:app /app /app

WORKDIR /app/scheduler

ENV PATH="/app/scheduler/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request, os; urllib.request.urlopen(f\"http://localhost:{os.environ.get('PORT','8080')}/healthz\")" || exit 1

CMD ["caipe-scheduler"]
