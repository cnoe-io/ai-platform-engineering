# ---------- Stage 0: Go toolchain (for github-mcp-server STDIO) ----------
FROM golang:1.24-bookworm AS golang

# ---------- Stage 1: Build dependencies ----------
FROM python:3.13-slim AS builder

# Install system dependencies and uv in one layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    git \
    && pip install uv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the entire project structure first since uv sync needs it to build
COPY --chown=root:root . /app/

# Install dependencies into venv (no dev deps) using committed lock file
# --locked ensures we use the existing uv.lock without modification
# Increase timeout for large packages (e.g., pyarrow 39MB)
RUN --mount=type=cache,target=/root/.cache/uv \
    UV_HTTP_TIMEOUT=300 uv sync --locked --no-dev

# Patch langchain_aws ChatBedrock._as_converse to forward base_model_id to
# ChatBedrockConverse. Without this, switching to the Converse API (e.g. when
# beta_use_converse_api=True) creates a new ChatBedrockConverse without base_model_id,
# triggering a GetInferenceProfile API call that fails when the IAM role only
# grants bedrock:InvokeModel / bedrock-runtime:Converse on the AIP ARN.
# Upstream issue: https://github.com/langchain-ai/langchain-aws/issues/953
# The 1.4.2 fix addressed _set_model_profile but _as_converse still does not forward
# base_model_id. Remove this patch once that is fixed upstream.
RUN BEDROCK_PY=".venv/lib/python3.13/site-packages/langchain_aws/chat_models/bedrock.py" && \
    grep -q 'guardrail_config=(self.guardrails if self._guardrails_enabled else None),  # type: ignore\[call-arg\]' "$BEDROCK_PY" || \
        { echo "ERROR: langchain_aws patch target not found — upstream may have changed. Review build/Dockerfile patch."; exit 1; } && \
    sed -i 's/guardrail_config=(self.guardrails if self._guardrails_enabled else None),  # type: ignore\[call-arg\]/guardrail_config=(self.guardrails if self._guardrails_enabled else None),  # type: ignore[call-arg]\n            base_model_id=self.base_model_id,/' "$BEDROCK_PY" && \
    grep -q 'base_model_id=self.base_model_id,' "$BEDROCK_PY" || \
        { echo "ERROR: langchain_aws patch was not applied — sed substitution had no effect."; exit 1; }

# ---------- Stage 2: Final runtime image ----------
FROM python:3.13-slim

# Install only runtime dependencies (including uv for MCP STDIO subprocess execution)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget \
    curl \
    grep \
    unzip \
    && pip install uv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# AWS CLI v2 — used by aws_cli_execute tool in single-node AWS subagent
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        curl -sfL --retry 5 --retry-delay 3 "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"; \
    else \
        curl -sfL --retry 5 --retry-delay 3 "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"; \
    fi && \
    unzip -q awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws

# kubectl — used by eks_kubectl_execute tool in single-node AWS subagent
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        KUBECTL_ARCH="arm64"; \
    else \
        KUBECTL_ARCH="amd64"; \
    fi && \
    KUBECTL_VERSION=$(curl -sfL --retry 5 --retry-delay 3 https://dl.k8s.io/release/stable.txt) && \
    if [ -z "$KUBECTL_VERSION" ]; then echo "Failed to fetch kubectl version"; exit 1; fi && \
    curl -sfLO --retry 5 --retry-delay 3 "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${KUBECTL_ARCH}/kubectl" && \
    chmod +x kubectl && \
    mv kubectl /usr/local/bin/kubectl

# Terraform CLI — used by terraform_fmt tool for HCL formatting in self-service tasks
RUN ARCH=$(dpkg --print-architecture) \
    && wget -q "https://releases.hashicorp.com/terraform/1.11.2/terraform_1.11.2_linux_${ARCH}.zip" -O /tmp/terraform.zip \
    && unzip -o /tmp/terraform.zip -d /usr/local/bin/ \
    && rm /tmp/terraform.zip \
    && chmod +x /usr/local/bin/terraform

# Go toolchain — needed at runtime by github-mcp-server (go run via STDIO)
COPY --from=golang /usr/local/go /usr/local/go

# Create appuser in final image
RUN groupadd -r appuser && useradd -r -g appuser -u 1001 -m appuser

WORKDIR /app

# Set env vars for uv & PATH
# PYTHONPATH includes all agent directories so that imports like 'from agent_github.tools'
# work in both single-node (unified container) and multi-node (standalone container) modes
ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    GOPATH="/home/appuser/go" \
    PATH="/app/.venv/bin:/usr/local/go/bin:/home/appuser/go/bin:${PATH}" \
    PYTHONPATH="/app/ai_platform_engineering/agents/github:/app/ai_platform_engineering/agents/backstage:/app/ai_platform_engineering/agents/jira:/app/ai_platform_engineering/agents/webex:/app/ai_platform_engineering/agents/argocd:/app/ai_platform_engineering/agents/aigateway:/app/ai_platform_engineering/agents/pagerduty:/app/ai_platform_engineering/agents/slack:/app/ai_platform_engineering/agents/splunk:/app/ai_platform_engineering/agents/komodor:/app/ai_platform_engineering/agents/confluence:/app/ai_platform_engineering/agents/aws:${PYTHONPATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Copy venv & code from builder
COPY --from=builder --chown=appuser:appuser /app /app

USER appuser

EXPOSE 8000

ENTRYPOINT [ "python", "-m", "ai_platform_engineering.multi_agents" ]
