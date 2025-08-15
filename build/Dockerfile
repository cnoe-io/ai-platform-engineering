FROM python:3.13-slim

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -u 1001 -m appuser

WORKDIR /app

# Copy minimal platform-engineer project metadata first to leverage caching
COPY --chown=appuser:appuser ai_platform_engineering/multi_agents/pyproject.toml /app/pyproject.toml
COPY --chown=appuser:appuser ai_platform_engineering/multi_agents/uv.lock /app/uv.lock

# Install Git and uv
RUN apt-get update && apt-get install -y git && pip install uv && rm -rf /var/lib/apt/lists/*

# Create UV cache directory for appuser and set permissions
RUN mkdir -p /home/appuser/.cache/uv && chown -R appuser:appuser /home/appuser/.cache

# Copy source code (filtered by .dockerignore)
COPY --chown=appuser:appuser ./ai_platform_engineering /app/ai_platform_engineering

# Change ownership of /app directory
RUN chown appuser:appuser /app

# Switch to non-root user
USER appuser

# Install minimal dependencies (without dev packages) with cache mount
RUN --mount=type=cache,target=/home/appuser/.cache/uv,uid=1001,gid=1001 \
    uv sync --no-dev

EXPOSE 8000

ENTRYPOINT [ "uv", "run", "python", "-m", "ai_platform_engineering.multi_agents" ]
