---
sidebar_position: 1
---

# AgentOps: Operations and Deployment Guide

## Definition of AgentOps

AgentOps involves the lifecycle management and operationalization of AI agentic Systems.

- **Agent Registry**: A repository for managing agent versions, configurations, and artifact provenance to ensure traceability and reproducibility.
- **Prompt Library**: A versioned artifact library for managing and evaluating prompts and their effectiveness.
- **MCP Registry**: A repository for managing MCP server versions, configurations, and artifact provenance to maintain accountability and integrity.

## Overview

This document describes the comprehensive AgentOps processes we follow for building, testing, deploying, and operating the AI Platform Engineering system. It covers GitHub Actions CI/CD, sanity checks, evaluations, Helm charts, and Kubernetes deployments.

### Architecture Philosophy

CAIPE AgentOps follows a **microservice deployment architecture** for distributed agents. This architecture enables:

- **Independent Scaling**: Each agent can be scaled independently based on workload
- **Isolated Deployments**: Agents are deployed as separate microservices with their own containers
- **Fault Isolation**: Failures in one agent don't cascade to others
- **Technology Flexibility**: Different agents can use different runtime configurations
- **Resource Optimization**: Allocate resources per agent based on actual needs
- **Independent Lifecycle**: Update, rollback, or replace agents without affecting the entire system
- **Container Registry Hosting**: Agents and MCP server containers are hosted in container registries like GitHub Container Registry (GHCR) for version control, distribution, and deployment

### AgentOps Methodology

The AI Platform Engineering project follows a comprehensive AgentOps methodology that ensures:

- **Automated Testing**: Quick and detailed sanity checks validate agent functionality
- **Continuous Integration**: GitHub Actions workflows automate builds, tests, and deployments
- **Quality Assurance**: Evaluation frameworks validate agent routing and tool usage
- **Infrastructure as Code**: Helm charts enable reproducible Kubernetes deployments
- **Observability**: Distributed tracing and logging provide visibility into agent operations
- **Microservice Architecture**: Distributed agents deployed as independent services

## Table of Contents

- [GitHub Actions CI/CD](#github-actions-cicd)
- [Sanity Checks](#sanity-checks)
- [Evaluations](#evaluations)
- [Helm Charts](#helm-charts)
- [Kubernetes Deployments](#kubernetes-deployments)
- [Monitoring and Observability](#monitoring-and-observability)
- [Best Practices](#best-practices)

## GitHub Actions CI/CD

### Architecture and Implementation

CAIPE uses GitHub Actions for comprehensive CI/CD automation, implementing a sophisticated workflow system that:

- **Change Detection**: Intelligently detects which agents/components changed to build only what's necessary
- **Matrix Builds**: Parallel builds across multiple agents and platforms for efficiency
- **Security Hardening**: Uses `step-security/harden-runner` to secure workflow execution
- **Multi-Platform Support**: Builds for both `linux/amd64` and `linux/arm64` architectures
- **Caching**: Leverages GitHub Actions cache for Docker layers to speed up builds
- **Conditional Execution**: Smart conditional logic to skip unnecessary builds

### Workflow Overview

Our CI/CD pipeline consists of multiple GitHub Actions workflows that run automatically on code changes:

#### 1. Quick Sanity Integration Tests

**Workflow**: [`tests-quick-sanity-integration-dev.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/tests-quick-sanity-integration-dev.yml)

**Purpose**: Fast integration tests that validate core agent functionality

**Triggers**:
- Push to `main` branch
- Manual trigger via `workflow_dispatch`

**Execution**:
- Runs on dedicated `caipe-integration-tests` runner
- Uses [`docker-compose.dev.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/docker-compose.dev.yaml) with `p2p` profile
- Executes `make quick-sanity` which runs [`test_prompts_quick_sanity.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/integration/test_prompts_quick_sanity.yaml)

**Test Configuration**: See [`integration/test_prompts_quick_sanity.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/integration/test_prompts_quick_sanity.yaml)

```yaml
# integration/test_prompts_quick_sanity.yaml
prompts:
  - id: "quick_test_1"
    messages:
      - role: "user"
        content: "Test prompt"
    expected_keywords: ["keyword1", "keyword2"]
    category: "quick_sanity"
```

**Key Steps**:
1. **Cleanup**: Remove Python cache files from previous runs
2. **Workspace Setup**: Ensure directory exists with correct permissions
3. **Checkout**: Clone repository code
4. **Secret Management**: Create `.env` from GitHub Secrets (masked in logs)
5. **Docker Setup**: Verify Docker and Docker Compose versions
6. **Python Setup**: Install Python 3.13 for A2A client tests
7. **Service Startup**: Start services with `docker compose -f docker-compose.dev.yaml --profile=p2p up -d`
8. **Log Streaming**: Stream logs in background to file and console
9. **Readiness Check**: Wait up to 3 minutes (36 retries × 5s) for service health
10. **Test Execution**: Run `make quick-sanity` which executes `test_prompts_quick_sanity.yaml`
11. **Artifact Upload**: Upload logs on failure for debugging
12. **Cleanup**: Stop containers, remove volumes, clean Docker images

**Implementation Details**:

**Dedicated Runner**:
- Uses `caipe-integration-tests` self-hosted runner
- Provides persistent Docker daemon
- Faster startup times compared to GitHub-hosted runners

**Readiness Check**:
```bash
# Checks both health endpoints
curl -sfS http://localhost:8000/ >/dev/null || \
curl -sfS http://localhost:8000/.well-known/agent.json >/dev/null
```

**Log Management**:
- Logs streamed to `compose-live.log` file
- Background process allows tests to run while logging
- Last 300 lines shown on failure
- Full logs uploaded as artifact

**Environment Setup**:
- Creates `.env` file with secrets from GitHub Actions secrets:
  - LLM provider credentials (Azure OpenAI)
  - Agent API tokens (ArgoCD, Backstage, Atlassian, GitHub, PagerDuty, Splunk, Komodor, Slack)
  - A2A transport configuration (`A2A_TRANSPORT=p2p`)
  - Tracing disabled (`ENABLE_TRACING=false`)

#### 2. Detailed Sanity Integration Tests

**Workflow**: [`tests-detailed-sanity-integration.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/tests-detailed-sanity-integration.yml)

**Purpose**: Comprehensive integration tests with verbose output

**Triggers**:
- Manual trigger via `workflow_dispatch` only

**Execution**:
- Runs on `ubuntu-latest` runner
- Uses production [`docker-compose.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/docker-compose.yaml) with `stable` image tag
- Executes `make detailed-test` which runs [`test_prompts_detailed.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/integration/test_prompts_detailed.yaml)

**Differences from Quick Sanity**:
- More comprehensive test coverage
- Uses production Docker Compose configuration
- Verbose logging enabled (`log_cli_level=INFO`)
- Longer test execution time

#### 3. Tag-Based Sanity Tests

**Workflows**:
- [`tests-quick-sanity-integration-on-latest-tag.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/tests-quick-sanity-integration-on-latest-tag.yml) - Tests against `latest` tag
- [`tests-quick-sanity-integration-on-stable-tag.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/tests-quick-sanity-integration-on-stable-tag.yml) - Tests against `stable` tag

**Purpose**: Validate that published container images work correctly

**Triggers**:
- Push to `main` branch
- Scheduled (nightly at 2 AM UTC for latest tag)
- Manual trigger

**Execution**:
- Pulls specific image tags from GitHub Container Registry
- Runs same quick sanity tests against tagged images
- Ensures published images maintain quality

#### 4. Helm Chart Testing

**Workflow**: [`helm-chart-test.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/helm-chart-test.yml)

**Purpose**: Validate Helm chart templates and configurations

**Triggers**:
- Push to `main` or `develop` branches (when `helm/**` changes)
- Pull requests (when `helm/**` changes)
- Scheduled (daily at 2 AM UTC)

**Test Matrix**:
- Tests against multiple Helm versions: `v3.18.2`, `v3.17.3`

**Test Scenarios**:
1. **Chart Validation**: Lint and package charts
2. **Dependency Management**: Verify external dependencies (Milvus, Neo4j, External Secrets)
3. **Installation Tests**: Dry-run installations with various configurations
4. **Resource Configuration**: Test with custom CPU/memory limits
5. **Ingress Configuration**: Test ingress setups
6. **Security Contexts**: Validate security settings
7. **Storage Classes**: Test persistent volume configurations
8. **Multi-Agent Configurations**: Test different agent combinations
9. **SLIM Integration**: Test SLIM transport configuration
10. **External Secrets**: Validate external secrets integration

**Example Test**:
```bash
helm template test-all-services . \
  --set ai-platform-engineering.enabled=true \
  --set backstage-plugin-agent-forge.enabled=true \
  --set kb-rag-stack.enabled=true \
  --set graphrag.enabled=true
```

#### 5. Helm Chart Publishing

**Workflow**: [`helm.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/helm.yml)

**Purpose**: Automatically publish Helm charts to GitHub Container Registry

**Triggers**:
- Push to `main` branch (when `charts/**` changes)
- Pull requests (when `charts/**` changes)

**Process**:

**1. Version Bump Check** (PR only):

Validates that chart versions are bumped when substantive changes are made:

```bash
# Detects which charts changed
CHART_CHANGES=$(git diff --name-only origin/$BASE_BRANCH...HEAD | grep "^charts/")

# Checks if changes are more than just Chart.lock
if echo "$CHART_CHANGES" | grep -qv "Chart.lock$"; then
  # Version bump required
  if [ "$CURRENT_VERSION" = "$BASE_VERSION" ]; then
    echo "❌ Error: Chart has changes but version was not bumped!"
    exit 1
  fi
fi
```

**Logic**:
- ✅ Skips version check for `Chart.lock`-only changes (dependency updates)
- ❌ Fails PR if substantive changes without version bump
- ✅ Allows new charts without version check

**2. Chart Packaging**:

```bash
# Update dependencies
helm dependency update charts/rag-stack/
helm dependency update charts/ai-platform-engineering/

# Package charts
helm package charts/rag-stack/ --destination ./packaged-charts/
helm package charts/ai-platform-engineering/ --destination ./packaged-charts/
```

**Dependency Verification**:
```bash
# Verify nested dependencies are included
tar -tzf charts/ai-platform-engineering/charts/rag-stack-*.tgz | \
  grep -q "^rag-stack/charts/neo4j/Chart.yaml"  # Must include neo4j
tar -tzf charts/ai-platform-engineering/charts/rag-stack-*.tgz | \
  grep -q "^rag-stack/charts/milvus/Chart.yaml"  # Must include milvus
```

**3. Chart Publishing**:

```bash
REGISTRY="oci://ghcr.io/${{ github.repository_owner }}/helm-charts"

# Check if version already exists
if helm pull $REGISTRY/$CHART_NAME --version $CHART_VERSION; then
  echo "⚠️  Version already exists, skipping"
else
  helm push "$CHART_FILE" $REGISTRY
fi
```

**Publishing Logic**:
- Only publishes on push to `main` branch
- Skips if version already exists (idempotent)
- Supports multiple charts: `rag-stack`, `ai-platform-engineering`
- Uses OCI registry format (`oci://`)

**Registry**: `oci://ghcr.io/cnoe-io/helm-charts`

**Installation**:
```bash
helm repo add cnoe-io oci://ghcr.io/cnoe-io/helm-charts
helm repo update
helm install ai-platform-engineering cnoe-io/ai-platform-engineering
```

#### 6. Agent Build Workflows

**Workflows**:
- [`ci-supervisor-agent.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/ci-supervisor-agent.yml) - Builds supervisor agent
- [`ci-mcp-sub-agent.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/ci-mcp-sub-agent.yml) - Builds MCP sub-agents
- [`ci-a2a-sub-agent.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/ci-a2a-sub-agent.yml) - Builds A2A sub-agents
- [`ci-a2a-rag.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/ci-a2a-rag.yml) - Builds RAG agents
- [`ci-agent-forge-plugin.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/ci-agent-forge-plugin.yml) - Builds Backstage plugin

**Purpose**: Build and publish container images for individual agents and MCP servers

**Container Registry**: All agent and MCP server containers are hosted in **GitHub Container Registry (GHCR)** at `ghcr.io/cnoe-io/`

##### Implementation Details

**1. Change Detection and Path Filtering**

Workflows use intelligent change detection to build only affected components. See [`ci-a2a-sub-agent.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/ci-a2a-sub-agent.yml) for implementation:

```yaml
# Example from ci-a2a-sub-agent.yml
- name: Detect changed paths
  id: filter
  uses: dorny/paths-filter@v3
  with:
    filters: |
      shared:
        - 'ai_platform_engineering/utils/a2a/**'
        - 'build/agents/Dockerfile.a2a'
      github:
        - 'ai_platform_engineering/agents/github/**'
        - '!ai_platform_engineering/agents/github/mcp/**'
```

**Logic**:
- **Push to `main` or tags**: Builds all agents
- **Pull Requests**: Only builds agents with changed files
- **Shared changes**: If shared utilities change, all agents are rebuilt
- **Manual dispatch**: Can force build all agents with `build_all: true` input

**2. Matrix Build Strategy**

Agents are built in parallel using GitHub Actions matrix:

```yaml
strategy:
  matrix:
    agent: ${{ fromJson(needs.determine-agents.outputs.agents) }}
  fail-fast: false  # Continue building other agents if one fails
```

**Supported Agents**:
- A2A Agents: `argocd`, `aws`, `backstage`, `confluence`, `github`, `jira`, `komodor`, `pagerduty`, `slack`, `splunk`, `template`, `webex`, `weather`
- MCP Agents: `argocd`, `backstage`, `confluence`, `jira`, `komodor`, `pagerduty`, `slack`, `splunk`, `webex`
- RAG Components: `agent-rag`, `agent-ontology`, `server`, `webui`

**Example**: When `ai_platform_engineering/agents/github/` changes, only `agent-github` and `mcp-github` images are built. When `ai_platform_engineering/utils/a2a/` changes, all agents are rebuilt.

**3. Security Hardening**

All build workflows use `step-security/harden-runner`:

```yaml
- name: 🔒 harden runner
  uses: step-security/harden-runner@95d9a5deda9de15063e7595e9719c11c38c90ae2
  with:
    egress-policy: audit  # Monitor outbound connections
```

**Benefits**:
- Prevents supply chain attacks
- Audits network egress
- Restricts unnecessary network access

**4. Multi-Platform Builds**

All images are built for both architectures:

```yaml
- name: Set up QEMU
  uses: docker/setup-qemu-action@v3

- name: Build and Push Docker image
  uses: docker/build-push-action@v6
  with:
    platforms: linux/amd64,linux/arm64
```

**Process**:
1. **Docker Buildx**: Sets up advanced build features
2. **QEMU**: Enables cross-platform builds (ARM64 on AMD64 runners)
3. **Parallel Builds**: Both architectures built simultaneously
4. **Manifest Lists**: Creates multi-arch manifests automatically

**5. Docker Layer Caching**

Uses GitHub Actions cache for faster builds:

```yaml
cache-from: type=gha  # GitHub Actions cache
cache-to: type=gha,mode=max  # Store all layers
```

**Cache Strategy**:
- **Cache Key**: Based on Dockerfile content and build context
- **Cache Scope**: Per workflow run, shared across matrix jobs
- **Cache Mode**: `max` stores all layers for maximum reuse
- **Benefits**: Reduces build time by 50-80% on subsequent runs

**6. Image Tagging Strategy**

Multiple tags are generated automatically:

```yaml
tags: |
  type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}
  type=ref,event=branch,prefix=
  type=ref,event=tag,prefix=
  type=sha,format=short,prefix=
```

**Tag Examples**:
- `latest` - Latest build from `main` branch
- `main` - Branch name tag
- `v1.2.3` - Semantic version tag
- `abc1234` - Short SHA tag
- `stable` - Production release tag (manual)

**7. Conditional Push Logic**

Images are only pushed on specific conditions:

```yaml
push: ${{ github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/') }}
```

**Push Conditions**:
- ✅ Push to `main` branch
- ✅ Push of tags (releases)
- ❌ Pull requests (build only, no push)
- ❌ Feature branches (unless manually triggered)

**8. Dockerfile Resolution**

Workflows support agent-specific Dockerfiles:

```yaml
- name: Determine Dockerfile path
  id: dockerfile
  run: |
    if [ -f "${{ env.AGENT_DIR }}/build/Dockerfile.a2a" ]; then
      echo "path=${{ env.AGENT_DIR }}/build/Dockerfile.a2a"
    else
      echo "path=build/agents/Dockerfile.a2a"  # Fallback to shared
    fi
```

**Priority**:
1. Agent-specific Dockerfile: `ai_platform_engineering/agents/{agent}/build/Dockerfile.{type}` (e.g., [`ai_platform_engineering/agents/github/build/Dockerfile.a2a`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/ai_platform_engineering/agents/github/build/Dockerfile.a2a))
2. Shared Dockerfile: [`build/agents/Dockerfile.{type}`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/build/agents) (e.g., [`build/agents/Dockerfile.a2a`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/build/agents/Dockerfile.a2a))

**9. Build Arguments**

Agent-specific build arguments:

```yaml
build-args: |
  AGENT_NAME=${{ matrix.agent }}
  AGENT_PACKAGE=${{ steps.agent_package.outputs.name }}
```

**Special Cases**:
- `template` agent uses `petstore` package name
- MCP agents use `AGENT_NAME` for MCP server configuration
- RAG components use component-specific build args

**10. Pre-Release Workflows**

Separate workflows for PR preview builds:

**Workflows**:
- [`pre-release-supervisor-agent.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/pre-release-supervisor-agent.yaml)
- [`pre-release-a2a-sub-agent.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/pre-release-a2a-sub-agent.yaml)
- [`pre-release-mcp-agent.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/pre-release-mcp-agent.yaml)
- [`pre-release-a2a-rag.yml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/pre-release-a2a-rag.yml)
- [`pre-release-agent-forge-plugin.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/pre-release-agent-forge-plugin.yaml)

**Trigger**: Pull requests with branch prefix `prebuild/`

**Image Naming**: `ghcr.io/cnoe-io/prebuild/{component}:{pr-number}`

**Purpose**: Preview images for testing before merge

**Image Naming Conventions**:
- **Agents**: `ghcr.io/cnoe-io/agent-{name}:{tag}` (e.g., `ghcr.io/cnoe-io/agent-github:stable`)
- **MCP Servers**: `ghcr.io/cnoe-io/mcp-{name}:{tag}` (e.g., `ghcr.io/cnoe-io/mcp-argocd:latest`)
- **Supervisor**: `ghcr.io/cnoe-io/ai-platform-engineering:{tag}`
- **Backstage Plugin**: `ghcr.io/cnoe-io/backstage-plugin-agent-forge:{tag}`
- **RAG Components**: `ghcr.io/cnoe-io/caipe-rag-{component}:{tag}` (e.g., `ghcr.io/cnoe-io/caipe-rag-server:latest`)

**Example Build Output**:
```bash
# After pushing to main branch
ghcr.io/cnoe-io/agent-github:latest
ghcr.io/cnoe-io/agent-github:main
ghcr.io/cnoe-io/agent-github:abc1234  # Short SHA

# After tagging v1.2.3
ghcr.io/cnoe-io/agent-github:v1.2.3
ghcr.io/cnoe-io/agent-github:1.2
ghcr.io/cnoe-io/agent-github:1
```

**Registry Benefits**:
- **Version Control**: Each container image is tagged with specific versions for reproducibility
- **Distribution**: Centralized registry enables easy deployment across environments
- **Security**: SBOM and attestations provide supply chain security
- **Access Control**: GitHub-based authentication and permissions
- **Multi-Platform**: Supports both AMD64 and ARM64 architectures
- **Parallel Builds**: Matrix strategy builds multiple agents simultaneously
- **Smart Caching**: Docker layer caching reduces build times significantly

### Workflow Best Practices

1. **Secret Management**: All secrets stored in GitHub Actions secrets, never hardcoded
2. **Artifact Retention**: Logs and test results retained for debugging
3. **Cleanup**: Always clean up Docker resources and workspace
4. **Failure Handling**: Upload logs and artifacts on failure for debugging
5. **Parallel Execution**: Independent workflows run in parallel for faster feedback

## Sanity Checks

### Quick Sanity

**Command**: `make quick-sanity`

**Purpose**: Fast validation of core agent functionality

**Execution**:
```bash
cd integration && A2A_PROMPTS_FILE=test_prompts_quick_sanity.yaml uv run pytest -o log_cli=true -o log_cli_level=DEBUG
```

**Test File**: [`integration/test_prompts_quick_sanity.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/integration/test_prompts_quick_sanity.yaml)

**Characteristics**:
- Minimal test set (5-10 prompts)
- Fast execution (< 5 minutes)
- Validates basic routing and responses
- Used in CI/CD for quick feedback

**Example**:
```bash
# Run quick sanity locally
make quick-sanity

# Output shows:
# ✓ GitHub agent routes correctly
# ✓ ArgoCD agent responds to queries
# ✓ Multi-agent orchestration works
# All tests passed in 3m 42s
```

### Detailed Sanity

**Command**: `make detailed-sanity` or `make detailed-test`

**Purpose**: Comprehensive validation of all agent capabilities

**Execution**:
```bash
cd integration && A2A_PROMPTS_FILE=test_prompts_detailed.yaml uv run pytest -o log_cli=true -o log_cli_level=INFO
```

**Test File**: [`integration/test_prompts_detailed.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/integration/test_prompts_detailed.yaml)

**Characteristics**:
- Comprehensive test coverage (20+ prompts)
- Tests all agent types (GitHub, ArgoCD, Jira, etc.)
- Validates complex multi-agent workflows
- Longer execution time (15-30 minutes)
- Used for pre-release validation

**Test Categories**:
- Single agent routing
- Multi-agent orchestration
- Tool usage validation
- Error handling
- Streaming responses

**Example**:
```bash
# Run detailed sanity
make detailed-sanity

# Tests 20+ scenarios including:
# - "Show GitHub repos and ArgoCD apps" → Parallel routing
# - "Who is on-call?" → Deep agent with PagerDuty + RAG
# - Error handling when agent unavailable
```

### ArgoCD-Specific Sanity

**Command**: `make argocd-sanity`

**Purpose**: Validate ArgoCD agent functionality

**Execution**:
```bash
cd integration && A2A_PROMPTS_FILE=test_prompts_argocd_sanity.yaml uv run pytest -o log_cli=true -o log_cli_level=INFO
```

**Test File**: [`integration/test_prompts_argocd_sanity.yaml`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/integration/test_prompts_argocd_sanity.yaml)

**Focus**: ArgoCD-specific operations:
- Application listing
- Application status checks
- Resource queries
- Cluster information

### Running Sanity Checks Locally

**Prerequisites**:
1. Services running: `docker compose -f docker-compose.dev.yaml --profile=p2p up -d`
2. Python 3.13+ with `uv` package manager
3. `.env` file configured with API credentials

**Quick Sanity**:
```bash
make quick-sanity
```

**Detailed Sanity**:
```bash
make detailed-sanity
```

**ArgoCD Sanity**:
```bash
make argocd-sanity
```

### Adding New Sanity Tests

**Method 1: YAML Configuration (Recommended)**

Add to appropriate test file:
```yaml
prompts:
  - id: "my_new_test"
    messages:
      - role: "user"
        content: "My test prompt"
    expected_keywords: ["keyword1", "keyword2"]
    category: "my_category"
```

**Method 2: Python Test Function**

Add to [`integration/integration_ai_platform_engineering.py`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/integration/integration_ai_platform_engineering.py):
```python
async def test_my_new_functionality(self):
    """Test my new functionality"""
    response = await send_message_to_agent("my prompt")
    assert response is not None
    assert len(response) > 0
    # Add specific assertions
```

## Evaluations

### Overview

The evaluation system provides automated testing of Platform Engineer multi-agent workflows using Langfuse dataset evaluation capabilities.

### Architecture

```
┌─────────────────┐
│  Langfuse UI    │
│   Dashboard     │
└────────┬────────┘
         │
         │ Trigger Evaluation
         ▼
┌─────────────────┐
│  Webhook Service│
│ langfuse_webhook│
└────────┬────────┘
         │
         │ Orchestrate
         ▼
┌─────────────────┐
│ Evaluation      │
│ Runner          │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────────┐
│ A2A    │ │ Trace        │
│ Client │ │ Extractor    │
└───┬────┘ └──────┬───────┘
    │             │
    │             │
    ▼             ▼
┌─────────────────────────┐
│  Platform Engineer      │
│  Multi-Agent System     │
└─────────────┬───────────┘
              │
              │ Auto-trace
              ▼
┌─────────────────────────┐
│  Langfuse Server        │
│  Trace Storage          │
└─────────────┬───────────┘
              │
              │ Analyze
              ▼
    ┌─────────────────┐
    │ Dual Evaluators │
    ├─────────────────┤
    │ Routing         │
    │ Evaluator       │
    ├─────────────────┤
    │ Tool Match      │
    │ Evaluator       │
    └────────┬────────┘
             │
             │ Submit Scores
             ▼
    ┌─────────────────┐
    │ Langfuse UI     │
    │ Results Display │
    └─────────────────┘
```

### Dual Evaluator System

The system uses two specialized evaluators:

1. **Routing Evaluator**: Validates supervisor-to-agent routing decisions
   - Checks if correct agent was selected
   - Validates routing logic
   - Scores: 0.0 - 1.0

2. **Tool Match Evaluator**: Validates agent-to-tool usage patterns
   - Checks if correct tools were used
   - Validates tool parameters
   - Scores: 0.0 - 1.0

### Quick Start

**1. Start the System**:
```bash
docker compose -f docker-compose.dev.yaml --profile p2p-tracing up
```

**2. Upload Dataset**:
```bash
cd evals
python upload_dataset.py datasets/single_agent.yaml
```

**3. Configure Webhook in Langfuse**:
- Navigate to Langfuse UI: http://localhost:3000
- Go to **Datasets** → Select your dataset
- Click **"Start Experiment"** → **"Custom Experiment"** (⚡ button)
- Set webhook URL: `http://evaluation-webhook:8000/evaluate`
- Click **"Run"** to start evaluation

**4. Monitor Results**:
- View evaluation progress in Langfuse dashboard
- Check individual trace scores and reasoning
- Analyze routing and tool usage patterns

### Dataset Format

```yaml
name: single_agent_tests
description: Single agent evaluation tests
prompts:
  - id: "github_repo_description"
    messages:
      - role: "user"
        content: "show repo description for ai-platform-engineering"
    expected_agents: ["github"]
    expected_behavior: "Should use GitHub agent to fetch repository description"
    expected_output: "The ai-platform-engineering repository is a platform engineering toolkit..."
```

**Example**: Upload and run evaluation:
```bash
# Upload dataset
cd evals
python upload_dataset.py datasets/single_agent.yaml

# Trigger evaluation via Langfuse UI
# Navigate to http://localhost:3000 → Datasets → Start Experiment
# Set webhook: http://evaluation-webhook:8000/evaluate
# Click "Run"

# Check results
curl http://localhost:8011/health
# Response shows evaluation status and scores
```

### Evaluation Flow

1. **Dataset Upload**: YAML datasets uploaded to Langfuse
2. **Webhook Trigger**: Langfuse UI triggers evaluation via webhook
3. **Request Processing**: Runner sends prompts to Platform Engineer via A2A
4. **Trace Analysis**: Extract tool calls and agent interactions from traces
5. **Dual Evaluation**:
   - Route correctness (supervisor → agent)
   - Tool alignment (agent → tool)
6. **Score Submission**: Results submitted back to Langfuse with detailed reasoning

### Environment Variables

```bash
# Langfuse configuration
export LANGFUSE_PUBLIC_KEY="pk-lf-your-key"
export LANGFUSE_SECRET_KEY="sk-lf-your-key"
export LANGFUSE_HOST="http://localhost:3000"

# Platform Engineer connection
export PLATFORM_ENGINEER_URL="http://localhost:8000"

# Optional: LLM evaluation (fallback uses pattern matching)
export OPENAI_API_KEY="your-openai-key"
```

### Monitoring

**Service Health**:
```bash
curl http://localhost:8011/health
```

**Response**:
```json
{
  "status": "healthy",
  "langfuse": "configured",
  "evaluators": ["routing", "tool_match"],
  "platform_engineer": "connected"
}
```

## Helm Charts

### Chart Structure

```
charts/
├── ai-platform-engineering/
│   ├── Chart.yaml
│   ├── values.yaml
│   ├── templates/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── ingress.yaml
│   │   ├── secret.yaml
│   │   └── ...
│   └── charts/
│       ├── agent/
│       ├── supervisor-agent/
│       └── backstage-plugin-agent-forge/
└── rag-stack/
    ├── Chart.yaml
    ├── values.yaml
    └── charts/
        ├── agent-rag/
        ├── agent-ontology/
        ├── rag-server/
        └── ...
```

### Main Charts

#### 1. AI Platform Engineering Chart

**Location**: [`charts/ai-platform-engineering/`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/charts/ai-platform-engineering)

**Components**:
- Supervisor agent (Platform Engineer)
- Individual agent deployments (GitHub, ArgoCD, Jira, etc.)
- MCP server deployments
- Backstage plugin agent-forge

**Key Features**:
- **Microservice Architecture**: Each agent deployed as independent Kubernetes deployment
- Multi-agent orchestration via supervisor agent
- Configurable prompt types (default, deep_agent, custom)
- External secrets support
- Ingress configuration per agent
- Horizontal Pod Autoscaling (HPA) per agent
- Resource limits and requests per agent
- Independent scaling and lifecycle management

#### 2. RAG Stack Chart

**Location**: [`charts/rag-stack/`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/charts/rag-stack)

**Components**:
- RAG server
- RAG web UI
- RAG agents (rag, ontology)
- Redis (persistent)
- Neo4j (via dependency)
- Milvus (via dependency)

**Dependencies**:
- Neo4j Helm chart
- Milvus Helm chart

### Prompt Configuration

The chart supports multiple prompt configurations with versioning:

#### Versioning Strategy

Prompt configuration files are versioned alongside the Helm chart:

- **Chart Version**: Tracked in `Chart.yaml` (`version: 0.4.7`)
- **App Version**: Tracked in `Chart.yaml` (`appVersion: 0.2.1`)
- **ConfigMap Labels**: Includes version metadata for traceability:
  ```yaml
  labels:
    app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
  ```

**Prompt Config Files**:
- `data/prompt_config.yaml` - Default configuration
- `data/prompt_config.deep_agent.yaml` - Deep agent configuration

When the Helm chart version is bumped, prompt config changes are included in that chart version, ensuring:
- **Reproducibility**: Specific chart versions always use the same prompt config
- **Traceability**: ConfigMap labels include version information
- **Rollback Safety**: Downgrading chart version restores previous prompt config

#### Default Configuration
```yaml
promptConfigName: "default"  # Uses data/prompt_config.yaml
```
- Balanced orchestrator
- General platform engineering tasks
- Medium strictness
- Versioned with chart release

#### Deep Agent Configuration
```yaml
promptConfigName: "deep_agent"  # Uses data/prompt_config.deep_agent.yaml
```
- Strict zero-hallucination mode
- Mission-critical operations
- High strictness
- Versioned with chart release

#### Custom Configuration
```yaml
promptConfig: |
  agent_name: "My Custom Platform Agent"
  agent_description: |
    Custom description...
  system_prompt_template: |
    Custom system prompt...
```
- Overrides versioned configs
- Not versioned by chart (managed separately)
- Use for specialized workflows

#### Versioned Config Selection

The Helm template selects config files based on `promptConfigName`:

```yaml
# Template logic in templates/prompt-config.yaml
{{- $configName := .Values.promptConfigName | default "deep_agent" }}
{{ .Files.Get (printf "data/prompt_config.%s.yaml" $configName) | nindent 4 }}
```

**Best Practice**: Always specify `promptConfigName` explicitly in your values file to ensure consistent behavior across upgrades:

```yaml
# values-secrets.yaml
promptConfigName: "deep_agent"  # Explicitly set for production
```

**Example**: Deploying with default prompt config:
```bash
helm install ai-platform-engineering . \
  --values values-secrets.yaml \
  --set promptConfigName=default
```

**Example**: Deploying with deep agent prompt config:
```bash
helm install ai-platform-engineering . \
  --values values-secrets.yaml \
  --set promptConfigName=deep_agent
```

### Deployment Options

#### Option 1: Simple Deployment (Port-Forward)

```bash
helm install ai-platform-engineering . --values values-secrets.yaml
```

**Access**:
```bash
kubectl port-forward service/ai-platform-engineering-agent-github 8001:8000
```

#### Option 2: Ingress Deployment

```bash
helm install ai-platform-engineering . \
  --values values-secrets.yaml \
  --values values-ingress.yaml
```

**Configure DNS**:
```bash
echo "$(minikube ip) agent-github.local" | sudo tee -a /etc/hosts
```

### Secret Management

#### Option 1: Direct Secrets
```bash
cp values-secrets.yaml.example values-secrets.yaml
# Edit with your values
helm install ai-platform-engineering . --values values-secrets.yaml
```

#### Option 2: Existing Kubernetes Secrets
```yaml
agent-argocd:
  secrets:
    secretName: "my-existing-secret"
```

#### Option 3: External Secrets (Recommended)
```bash
cp values-external-secrets.yaml.example values-external-secrets.yaml
# Configure external secrets store
helm install ai-platform-engineering . --values values-external-secrets.yaml
```

### Chart Testing

**Local Testing**:
```bash
helm template test . --values values-secrets.yaml
```

**Dry-Run Installation**:
```bash
helm install --dry-run --debug ai-platform-engineering . --values values-secrets.yaml
```

**Chart Linting**:
```bash
helm lint charts/ai-platform-engineering/
```

See [`charts/ai-platform-engineering/`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/charts/ai-platform-engineering) and [`charts/rag-stack/`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/charts/rag-stack) for chart source code.

### Chart Publishing

Charts are automatically published to GitHub Container Registry on merge to `main`:

**Registry**: `oci://ghcr.io/cnoe-io/helm-charts`

**Installation**:
```bash
helm repo add cnoe-io oci://ghcr.io/cnoe-io/helm-charts
helm repo update
helm install ai-platform-engineering cnoe-io/ai-platform-engineering
```

## Kubernetes Deployments

### Microservice Architecture

CAIPE follows a **microservice deployment architecture** where each agent is deployed as an independent Kubernetes service:

- **Independent Deployments**: Each agent (GitHub, ArgoCD, Jira, etc.) runs in its own pod/deployment
- **Service Isolation**: Agents communicate via A2A protocol, not direct dependencies
- **Individual Scaling**: Scale agents independently based on workload (e.g., scale GitHub agent separately from ArgoCD)
- **Resource Allocation**: Set CPU/memory limits per agent based on actual usage patterns
- **Health Checks**: Each agent has its own liveness and readiness probes
- **Rolling Updates**: Update individual agents without affecting others
- **Fault Tolerance**: Agent failures are isolated and don't cascade

**Example Architecture**:
```
┌─────────────────────────────────────┐
│  Supervisor Agent (Orchestrator)   │
│  - Routes requests to agents        │
│  - Manages multi-agent workflows   │
└──────────────┬──────────────────────┘
               │
       ┌───────┴────────┐
       │  A2A Protocol  │
       └───────┬────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│ GitHub │ │ ArgoCD │ │  Jira │
│ Agent  │ │ Agent  │ │ Agent │
│ Pod    │ │ Pod    │ │ Pod   │
└────────┘ └────────┘ └────────┘
    │          │          │
    └──────────┼──────────┘
               │
        ┌──────┴──────┐
        │  MCP Servers │
        │  (Separate)  │
        └─────────────┘
```

### Prerequisites

- Kubernetes cluster (1.24+)
- Helm 3.14+
- kubectl configured
- **Container Registry Access**: Access to GitHub Container Registry (`ghcr.io/cnoe-io/`) where all agent and MCP server containers are hosted
  - Authenticate: `echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin`
  - Pull images: `docker pull ghcr.io/cnoe-io/agent-github:stable`

### Deployment Steps

#### 1. Configure Secrets

Create `values-secrets.yaml`:
```yaml
global:
  imageRegistry: ghcr.io/cnoe-io

ai-platform-engineering:
  enabled: true
  image:
    repository: ai-platform-engineering
    tag: stable

agent-github:
  enabled: true
  secrets:
    secretName: agent-secrets
```

#### 2. Create Kubernetes Secrets

```bash
kubectl create secret generic agent-secrets \
  --from-literal=GITHUB_PERSONAL_ACCESS_TOKEN=your-token \
  --from-literal=AZURE_OPENAI_API_KEY=your-key
```

#### 3. Install Chart

```bash
helm install ai-platform-engineering . \
  --namespace ai-platform \
  --create-namespace \
  --values values-secrets.yaml
```

#### 4. Verify Deployment

```bash
kubectl get pods -n ai-platform
# Expected output:
# NAME                                    READY   STATUS    RESTARTS   AGE
# ai-platform-engineering-supervisor-0    1/1     Running   0          2m
# agent-github-7d8f9c4b5-abc12           1/1     Running   0          2m
# agent-argocd-6c7e8d9a0-def34           1/1     Running   0          2m

kubectl get services -n ai-platform
kubectl get ingress -n ai-platform
```

**Example**: Check specific agent logs:
```bash
kubectl logs -n ai-platform deployment/agent-github --tail=50
```

### Resource Management

**Resource Limits**:
```yaml
agent-github:
  resources:
    limits:
      cpu: 1000m
      memory: 2Gi
    requests:
      cpu: 500m
      memory: 1Gi
```

**Horizontal Pod Autoscaling**:
```yaml
agent-github:
  autoscaling:
    enabled: true
    minReplicas: 1
    maxReplicas: 5
    targetCPUUtilizationPercentage: 80
```

### High Availability

**Multi-Replica Deployment**:
```yaml
agent-github:
  replicaCount: 3
  podDisruptionBudget:
    enabled: true
    minAvailable: 2
```

**Node Affinity**:
```yaml
agent-github:
  nodeSelector:
    kubernetes.io/os: linux
  affinity:
    podAntiAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            labelSelector:
              matchExpressions:
                - key: app
                  operator: In
                  values:
                    - agent-github
            topologyKey: kubernetes.io/hostname
```

### Persistent Storage

**Redis Persistence**:
```yaml
rag-redis:
  persistence:
    enabled: true
    storageClass: fast-ssd
    size: 10Gi
```

### Network Policies

**Ingress Configuration**:
```yaml
agent-github:
  ingress:
    enabled: true
    className: nginx
    hosts:
      - host: agent-github.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: agent-github-tls
        hosts:
          - agent-github.example.com
```

### Monitoring Integration

**ServiceMonitor for Prometheus**:
```yaml
agent-github:
  serviceMonitor:
    enabled: true
    interval: 30s
    scrapeTimeout: 10s
```

### Troubleshooting

**View Pod Logs**:
```bash
kubectl logs -n ai-platform deployment/agent-github -f
```

**Describe Pod**:
```bash
kubectl describe pod -n ai-platform agent-github-xxx
```

**Check Events**:
```bash
kubectl get events -n ai-platform --sort-by='.lastTimestamp'
```

**Port Forward for Debugging**:
```bash
kubectl port-forward -n ai-platform service/agent-github 8001:8000
# Test agent at http://localhost:8001
```

**Example**: Debugging a failing agent:
```bash
# Check pod status
kubectl get pods -n ai-platform | grep agent-github
# Output: agent-github-xxx   0/1   CrashLoopBackOff   3   2m

# Check logs for errors
kubectl logs -n ai-platform agent-github-xxx --previous

# Check events for resource issues
kubectl describe pod -n ai-platform agent-github-xxx | grep -A 5 Events

# Common issues:
# - ImagePullBackOff: Check registry access
# - CrashLoopBackOff: Check application logs
# - OOMKilled: Increase memory limits
```

## Monitoring and Observability

### Distributed Tracing

**Langfuse Integration**:
- Automatic trace collection
- Tool call tracking
- Agent interaction visualization
- Performance metrics

**Configuration**:
```yaml
agent-github:
  environment:
    - name: ENABLE_TRACING
      value: "true"
    - name: LANGFUSE_PUBLIC_KEY
      valueFrom:
        secretKeyRef:
          name: langfuse-secrets
          key: public-key
    - name: LANGFUSE_SECRET_KEY
      valueFrom:
        secretKeyRef:
          name: langfuse-secrets
          key: secret-key
    - name: LANGFUSE_HOST
      value: "http://langfuse-web:3000"
```

### Logging

**Log Levels**:
- `DEBUG`: Detailed debugging information
- `INFO`: General operational information
- `WARNING`: Warning messages
- `ERROR`: Error conditions

**Log Aggregation**:
- Structured JSON logging
- Centralized log collection (via Fluentd/Fluent Bit)
- Log retention policies

### Metrics

**Key Metrics**:
- Request rate
- Response time (p50, p95, p99)
- Error rate
- Agent routing decisions
- Tool usage patterns

**Prometheus Integration**:
```yaml
agent-github:
  serviceMonitor:
    enabled: true
    path: /metrics
    port: http
```

### Health Checks

**Liveness Probe**:
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: http
  initialDelaySeconds: 30
  periodSeconds: 10
```

**Readiness Probe**:
```yaml
readinessProbe:
  httpGet:
    path: /.well-known/agent.json
    port: http
  initialDelaySeconds: 10
  periodSeconds: 5
```

## Best Practices

### Development

1. **Run Quick Sanity Before Committing**: `make quick-sanity`
2. **Run Detailed Sanity Before Release**: `make detailed-sanity`
3. **Test Helm Charts Locally**: `helm template test . --values values-secrets.yaml`
4. **Validate Kubernetes Manifests**: `kubectl apply --dry-run=client -f manifests/`

### CI/CD

1. **Version Bumps**: Always bump chart versions for substantive changes
2. **Secret Management**: Never commit secrets, use GitHub Actions secrets
3. **Artifact Retention**: Keep logs and test results for debugging
4. **Parallel Execution**: Use workflow dependencies for parallel runs

### Deployment

1. **Staging First**: Deploy to staging before production
2. **Gradual Rollout**: Use canary deployments for major changes
3. **Rollback Plan**: Always have a rollback strategy
4. **Monitoring**: Set up alerts before deployment

### Operations

1. **Resource Limits**: Always set resource limits and requests
2. **Health Checks**: Configure liveness and readiness probes
3. **Logging**: Enable structured logging and centralized collection
4. **Tracing**: Enable distributed tracing for production workloads

## Summary

This AgentOps guide provides a comprehensive overview of:

- **CI/CD**: Automated testing and deployment via GitHub Actions
- **Sanity Checks**: Quick and detailed validation of agent functionality
- **Evaluations**: Automated assessment of agent routing and tool usage
- **Helm Charts**: Infrastructure as code for Kubernetes deployments
- **Kubernetes**: Production-ready deployment configurations

Following these practices ensures reliable, scalable, and maintainable AI Platform Engineering deployments.
