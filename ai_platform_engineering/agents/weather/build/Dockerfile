FROM python:3.13-slim

WORKDIR /app

COPY . /app/

# Install uv and use it to install the package
RUN pip install uv poetry

RUN poetry config virtualenvs.create false
RUN poetry config virtualenvs.in-project false
RUN poetry config cache-dir /app/.cache

RUN poetry install --no-interaction --no-root

EXPOSE 8000

CMD ["poetry", "--quiet", "run", "python", "-m", "agent_weather", "--host", "0.0.0.0", "--port", "8000"]