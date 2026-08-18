FROM python:3.13-slim AS builder

RUN pip install --no-cache-dir uv
WORKDIR /workspace
COPY ai_platform_engineering/__init__.py /workspace/ai_platform_engineering/__init__.py
COPY ai_platform_engineering/authz /workspace/ai_platform_engineering/authz
WORKDIR /workspace/ai_platform_engineering/authz
RUN uv sync --locked --no-dev

FROM cgr.dev/chainguard/wolfi-base:latest
RUN apk add --no-cache python-3.13 shadow && apk upgrade --no-cache
RUN groupadd -r -g 1001 appuser && useradd -r -g appuser -u 1001 -M -s /sbin/nologin appuser
COPY --from=builder --chown=appuser:appuser /workspace /workspace
WORKDIR /workspace
USER 1001:1001
ENV PATH="/workspace/ai_platform_engineering/authz/.venv/bin:$PATH"
EXPOSE 8090 9191
CMD ["python", "-m", "ai_platform_engineering.authz.main"]
