FROM python:3.13-slim

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -u 1001 appuser

WORKDIR /app

# Copy project metadata first to leverage caching
COPY pyproject.toml uv.lock /app/

# Install Git and uv
RUN apt-get update && apt-get install -y git && pip install uv && rm -rf /var/lib/apt/lists/*

# Create UV cache directory for appuser and set permissions
RUN mkdir -p /home/appuser/.cache/uv && chown -R appuser:appuser /home/appuser/.cache

# Copy actual source code and set ownership
COPY --chown=appuser:appuser ./ai_platform_engineering /app/ai_platform_engineering

# Install dependencies (without dev packages) with cache mount
RUN --mount=type=cache,target=/home/appuser/.cache/uv \
    uv sync --locked --no-dev

# Change ownership of the entire app directory
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

EXPOSE 8000

ENTRYPOINT [ "uv", "run", "python", "-m", "ai_platform_engineering.multi_agents" ]
