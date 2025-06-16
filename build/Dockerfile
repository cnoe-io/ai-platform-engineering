FROM python:3.13

WORKDIR /app

COPY . /app/

# Install uv and use it to install the package
RUN pip install uv poetry

RUN poetry config virtualenvs.create true
RUN poetry config virtualenvs.in-project true
RUN poetry config cache-dir /app/.cache
RUN poetry config virtualenvs.path /app/.venv

RUN poetry build

RUN poetry install --no-interaction

EXPOSE 8000

ENTRYPOINT [ "poetry", "run", "ai-platform-engineering" ]