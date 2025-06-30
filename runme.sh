#!/bin/bash

# Create directories if they don't exist
mkdir -p build docs/diagrams tests/unit tests/integration tests/e2e
mkdir -p evals/agentevals/test_cases evals/datasets evals/prompts

mkdir -p ai_platform_engineering/mcp/servers/foo1/{schemas,tools,adapters}
mkdir -p ai_platform_engineering/mcp/servers/foo2/{schemas,tools,adapters}

for agent in argocd atlassian backstage github pagerduty slack reflection; do
  mkdir -p ai_platform_engineering/agents/$agent/{server,client}
done

mkdir -p ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/{a2a,fastapi}
mkdir -p ai_platform_engineering/multi_agents/incident_engineer
mkdir -p ai_platform_engineering/multi_agents/product_owner

mkdir -p ai_platform_engineering/knowledge_bases/{platform_docs,ops_runbooks,shared,graph_rag/examples}
mkdir -p ai_platform_engineering/cli
mkdir -p ai_platform_engineering/common
mkdir -p ai_platform_engineering/utils/a2a
mkdir -p ai_platform_engineering/utils/codegen-agent
mkdir -p ai_platform_engineering/utils/models

mkdir -p deployment/helm/ai-platform-engineer/templates/tests
mkdir -p deployment/helm/external-secrets-configuration/templates

# Create files only if they don't already exist
touch_if_missing() {
  [ ! -f "$1" ] && touch "$1"
}

# Top-level files
for file in README.md CHANGELOG.md CODE_OF_CONDUCT.md CONTRIBUTING.md LICENSE MAINTAINERS.md SECURITY.md poetry.toml poetry.lock Makefile docker-compose.yaml; do
  touch_if_missing "$file"
done

# Build
touch_if_missing build/langgraph.json

# Docs
touch_if_missing docs/index.md

# Evals
touch_if_missing evals/agentevals/config.yaml
touch_if_missing evals/agentevals/test_cases/platform_tasks.json
touch_if_missing evals/prompts/task_chains.yaml
touch_if_missing evals/prompts/metrics.yaml
touch_if_missing evals/runner.py

# MCP Servers (foo1 and foo2)
for server in foo1 foo2; do
  touch_if_missing ai_platform_engineering/mcp/servers/$server/pyproject.toml
  touch_if_missing ai_platform_engineering/mcp/servers/$server/main.py
  touch_if_missing ai_platform_engineering/mcp/servers/$server/schemas/openapi.yaml
  touch_if_missing ai_platform_engineering/mcp/servers/$server/tools/register.py
  touch_if_missing ai_platform_engineering/mcp/servers/$server/tools/${server}_specific.py
  touch_if_missing ai_platform_engineering/mcp/servers/$server/adapters/tool_output.py
  touch_if_missing ai_platform_engineering/mcp/servers/$server/adapters/langchain_bindings.py
done

# Agent pyproject.toml
for agent in argocd atlassian backstage github pagerduty slack reflection; do
  touch_if_missing ai_platform_engineering/agents/$agent/pyproject.toml
done

# Multi-agent
touch_if_missing ai_platform_engineering/multi_agents/platform_engineer/pyproject.toml
touch_if_missing ai_platform_engineering/multi_agents/platform_engineer/main.py
touch_if_missing ai_platform_engineering/multi_agents/incident_engineer/pyproject.toml
touch_if_missing ai_platform_engineering/multi_agents/incident_engineer/main.py
touch_if_missing ai_platform_engineering/multi_agents/product_owner/pyproject.toml
touch_if_missing ai_platform_engineering/multi_agents/product_owner/main.py

# Knowledge bases
touch_if_missing ai_platform_engineering/knowledge_bases/platform_docs/loader.py
touch_if_missing ai_platform_engineering/knowledge_bases/platform_docs/embedder.py
touch_if_missing ai_platform_engineering/knowledge_bases/platform_docs/vectorstore.py
touch_if_missing ai_platform_engineering/knowledge_bases/shared/base.py
touch_if_missing ai_platform_engineering/knowledge_bases/shared/retriever_factory.py
touch_if_missing ai_platform_engineering/knowledge_bases/graph_rag/pyproject.toml
touch_if_missing ai_platform_engineering/knowledge_bases/graph_rag/graph.py
touch_if_missing ai_platform_engineering/knowledge_bases/graph_rag/router.py
touch_if_missing ai_platform_engineering/knowledge_bases/graph_rag/retrievers.py
touch_if_missing ai_platform_engineering/knowledge_bases/graph_rag/examples/run_demo.py

# CLI
touch_if_missing ai_platform_engineering/cli/pyproject.toml
touch_if_missing ai_platform_engineering/cli/__init__.py
touch_if_missing ai_platform_engineering/cli/main.py

# Common
touch_if_missing ai_platform_engineering/common/pyproject.toml
touch_if_missing ai_platform_engineering/common/constants.py
touch_if_missing ai_platform_engineering/common/decorators.py
touch_if_missing ai_platform_engineering/common/registry.py
touch_if_missing ai_platform_engineering/common/errors.py

# Utils
touch_if_missing ai_platform_engineering/utils/pyproject.toml
touch_if_missing ai_platform_engineering/utils/a2a/transport.py
touch_if_missing ai_platform_engineering/utils/a2a/auth.py
touch_if_missing ai_platform_engineering/utils/models/__init__.py
touch_if_missing ai_platform_engineering/utils/models/base.py
touch_if_missing ai_platform_engineering/utils/models/agents.py
touch_if_missing ai_platform_engineering/utils/models/events.py
touch_if_missing ai_platform_engineering/utils/models/tasks.py

