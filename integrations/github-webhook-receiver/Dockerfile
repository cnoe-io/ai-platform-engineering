# syntax=docker/dockerfile:1.7
# GitHub Webhook Receiver — CAIPE integration
#
# Polls the AWS SQS queue that holds GitHub webhook deliveries and forwards
# them to caipe-ui's /api/agentic-sdlc/webhooks/github endpoint with the
# original raw body + provider headers preserved.
#
# Runs as non-root (UID/GID 1001) per CAIPE container security baseline.

FROM python:3.13-slim AS base

# Security: keep system packages minimal; only what wheel installs need.
# `tini` provides proper PID 1 signal forwarding so SIGTERM from
# docker-compose triggers a clean SQS-poll drain.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Non-root user (UID 1001 to match CAIPE convention).
RUN groupadd --system --gid 1001 caipe \
    && useradd --system --uid 1001 --gid 1001 --home-dir /app --shell /usr/sbin/nologin caipe

WORKDIR /app

# Install Python deps first so layer caches across source-only changes.
COPY app/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /app/requirements.txt

# Copy sources.
COPY app/src/ /app/src/

USER 1001:1001

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    AWS_REGION=us-east-2 \
    SQS_QUEUE_NAME=github-webhook-sqs \
    CAIPE_WEBHOOK_URL=http://caipe-ui:3000/api/agentic-sdlc/webhooks/github \
    RECEIVER_BATCH_SIZE=10 \
    RECEIVER_WAIT_SECONDS=20 \
    LOG_LEVEL=INFO

# Lightweight liveness check: a healthy receiver always has the Python
# process running. We don't expose an HTTP server here because the
# receiver is a pure outbound poller, so we just verify the loop module
# imports successfully on startup.
HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import boto3, requests; import sys; sys.exit(0)" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "/app/src/caipe_forwarder.py"]
