FROM python:3.13-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    git \
    && pip install uv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create appuser
RUN groupadd -r appuser && useradd -r -g appuser -u 1001 -m appuser

WORKDIR /app

# Copy project files
COPY --chown=appuser:appuser . /app/

# Install dependencies
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev

# Set environment variables
ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER appuser

EXPOSE 8000

# Run the webhook service
CMD ["uvicorn", "ai_platform_engineering.evaluation.platform_engineer.webhooks.langfuse_webhook:app", "--host", "0.0.0.0", "--port", "8000"]