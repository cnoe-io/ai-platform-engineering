# First, build the application in the `/app` directory.
# See `Dockerfile` for details.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# Disable Python downloads, because we want to use the system interpreter
# across both images. If using a managed Python version, it needs to be
# copied from the build image into the final image; see `standalone.Dockerfile`
# for an example.
ENV UV_PYTHON_DOWNLOADS=0

# Copy over the local dependencies
COPY core /app/core

WORKDIR /app/agent_graph_qa
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=agent_graph_qa/uv.lock,target=uv.lock \
    --mount=type=bind,source=agent_graph_qa/pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

COPY agent_graph_qa .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev


# Then, use a final image without uv
FROM python:3.13-slim-bookworm
# It is important to use the image that matches the builder, as the path to the
# Python executable must be the same, e.g., using `python:3.13-slim-bookworm`
# will fail.

# Copy the application from the builder
COPY --from=builder --chown=app:app /app /app

WORKDIR /app/agent_graph_qa

# Place executables in the environment at the front of the path
ENV PATH="/app/agent_graph_qa/.venv/bin:$PATH"

# Run the application by default
CMD ["python3", "src/agent_graph_qa"]