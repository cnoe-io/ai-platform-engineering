FROM python:3.13-slim

WORKDIR /app

COPY pyproject.toml README.md uv.lock /app/
COPY ai_platform_engineering /app/ai_platform_engineering

# Install poetry
RUN pip install uv

RUN uv sync --no-dev

EXPOSE 8000

ENTRYPOINT [ "uv", "run", "ai_platform_engineering/multi_agents" ]
