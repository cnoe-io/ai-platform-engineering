FROM python:3.13-slim

WORKDIR /app

COPY pyproject.toml uv.lock README.md /app/

COPY ./ai_platform_engineering /app/ai_platform_engineering

# Install poetry
RUN pip install uv

RUN uv sync --no-dev

EXPOSE 8000

ENTRYPOINT [ "uv", "run", "python", "/app/ai_platform_engineering/multi_agents"]
