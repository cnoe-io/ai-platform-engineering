FROM python:3.13-slim

WORKDIR /app

# Copy project metadata first to leverage caching
COPY pyproject.toml uv.lock /app/

# Install Git and uv
RUN apt-get update && apt-get install -y git && pip install uv

# Copy actual source code
COPY ./ai_platform_engineering /app/ai_platform_engineering

# Install dependencies (without dev packages)
RUN uv sync --locked --no-dev

EXPOSE 8000

ENTRYPOINT [ "uv", "run", "python", "-m", "ai_platform_engineering.multi_agents" ]
