FROM python:3.13-slim

WORKDIR /app

COPY pyproject.toml poetry.lock /app/
COPY ai_platform_engineering /app/ai_platform_engineering
COPY README.md /app/

# Install poetry
RUN pip install poetry

RUN poetry config virtualenvs.create true
RUN poetry config virtualenvs.in-project true
RUN poetry config cache-dir /app/.cache
RUN poetry config virtualenvs.path /app/.venv

RUN poetry build

RUN poetry install --no-interaction

EXPOSE 8000

ENTRYPOINT [ "poetry", "run", "ai-platform-engineering" ]