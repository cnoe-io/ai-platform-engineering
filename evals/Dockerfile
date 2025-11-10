# Use Python 3.13 slim image
FROM python:3.13-slim

# Install system dependencies and uv
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Set working directory
WORKDIR /app

# Copy dependency files first for better Docker layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies only (no package installation needed)
# Increase timeout for large packages (e.g., pyarrow 39MB)
RUN UV_HTTP_TIMEOUT=300 uv sync --frozen --no-cache --no-dev

# Copy source code
COPY . .

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /app
USER app

# Expose port
EXPOSE 8000

# Set environment variables
ENV PYTHONPATH=/app
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

# Health check (runs as app user)
HEALTHCHECK --interval=30s --timeout=30s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Command to run the application
CMD ["uv", "run", "uvicorn", "webhook.langfuse_webhook:app", "--host", "0.0.0.0", "--port", "8000"]