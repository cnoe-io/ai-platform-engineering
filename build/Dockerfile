FROM python:3.13-slim

WORKDIR /app

# Copy project metadata first to leverage caching
COPY pyproject.toml uv.lock /app/

# Install uv
RUN pip install uv

# Install dependencies (without dev packages)
RUN uv sync --locked --no-dev

# Copy actual source code
COPY ./ai_platform_engineering /app/ai_platform_engineering

EXPOSE 8000

ENTRYPOINT [ "uv", "run", "python", "-m", "ai_platform_engineering.multi_agents" ]
