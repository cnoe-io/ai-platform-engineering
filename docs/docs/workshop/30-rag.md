# RAG and Git Tools

## Overview

This part adds knowledge retrieval and GitHub tooling to the current CAIPE local stack.

Mission 4 starts:

- CAIPE UI.
- Dynamic Agents.
- MongoDB.
- NetUtils MCP server.
- GitHub MCP server.
- RAG server.
- Redis, Milvus, etcd, and MinIO for vector storage.

RAG A2A remains valid elsewhere in the platform, but this workshop flow uses the current RAG server and its UI/MCP integration.

## Start the Stack

From the repository root:

```bash
docker compose -f workshop/docker-compose.mission4.yaml up -d --build
```

Open:

- CAIPE UI: [http://localhost:3000](http://localhost:3000)
- Dynamic Agents health: [http://localhost:8100/healthz](http://localhost:8100/healthz)
- RAG health: [http://localhost:9446/healthz](http://localhost:9446/healthz)

Check containers:

```bash
docker compose -f workshop/docker-compose.mission4.yaml ps
```

## Configure Environment

Set LLM and embedding credentials before starting the stack, or add them to your shell environment:

```bash
export LLM_PROVIDER=azure-openai
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_API_VERSION=...
export AZURE_OPENAI_DEPLOYMENT=...
export AZURE_OPENAI_ENDPOINT=...
export EMBEDDINGS_PROVIDER=azure-openai
export EMBEDDINGS_MODEL=text-embedding-3-large
```

For GitHub tools:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=...
```

## Configure MCP Servers

In the CAIPE UI:

1. Open **Admin**.
2. Open **MCP Servers**.
3. Add NetUtils:
   - ID: `netutils`
   - Transport: `http`
   - Endpoint: `http://mcp-netutils:8000/mcp`
4. Add Knowledge Base:
   - ID: `knowledge-base`
   - Transport: `http`
   - Endpoint: `http://rag-server:9446/mcp`
5. Add GitHub:
   - ID: `github`
   - Transport: `http`
   - Endpoint: `http://github-mcp-server:8082`

## Configure a Dynamic Agent

Create an agent in **Admin > Dynamic Agents**:

- Name: `Knowledge Helper`
- Model: select a model configured for your environment.
- System prompt: `Use knowledge-base and GitHub tools when they help answer platform engineering questions.`
- Allowed tools:
  - `knowledge-base`
  - `github`
  - `netutils`

Start a chat with this agent.

## Populate the Knowledge Base

In the CAIPE UI:

1. Open **Knowledge Bases**.
2. Add a datasource.
3. Ingest a documentation site, for example:

```text
https://docs.agntcy.org
```

4. Wait until ingestion completes or enough documents have been indexed for search.

## Test Retrieval

In **Knowledge Bases > Search**, run:

```text
What is SLIM?
```

Then ask the Dynamic Agent:

```text
Tell me more about SLIM in AGNTCY and cite the retrieved source material.
```

## Test GitHub Tools

Use a low-risk read-only prompt first:

```text
Use GitHub tools to summarize the latest open issues in my configured repository.
```

Only run write prompts when the token and target repository are intentionally configured for the lab.

## Logs

Useful checks:

```bash
docker logs dynamic-agents
docker logs rag-server
docker logs github-mcp-server
```

Look for:

- Dynamic Agents startup and chat requests.
- RAG server startup and ingestion requests.
- GitHub MCP startup and tool-call errors.

## Clean Up

```bash
docker compose -f workshop/docker-compose.mission4.yaml down
```

Add `-v` only when you intentionally want to remove MongoDB, Redis, Milvus, and MinIO data:

```bash
docker compose -f workshop/docker-compose.mission4.yaml down -v
```

## Summary

You added RAG and GitHub MCP tools to a Dynamic Agent. Continue to [Tracing and Observability](/docs/workshop/tracing) to inspect tool and LLM execution with Langfuse.
