FROM python:3.13-slim

WORKDIR /app

COPY pyproject.toml poetry.lock /app/
COPY . /app

# Install poetry
RUN pip install poetry

RUN poetry config virtualenvs.create false
RUN poetry config virtualenvs.in-project false
RUN poetry config cache-dir /app/.cache

RUN poetry lock
RUN poetry install --no-interaction

EXPOSE 8000

ENTRYPOINT [ "poetry", "run", "ai-platform-engineering" ]
