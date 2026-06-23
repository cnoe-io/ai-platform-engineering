# Multi-Agent Systems and CAIPE

## Overview

This part runs the current CAIPE local stack:

- CAIPE UI for chat and configuration.
- Dynamic Agents for agent execution.
- MongoDB for agent, MCP server, and conversation state.
- NetUtils MCP server for network diagnostic tools.

The old workshop used standalone platform and worker agent containers. The current workshop uses Dynamic Agents plus MCP servers.

## Concepts

### Multi-Agent Systems

A multi-agent system decomposes work across specialized runtimes, tools, or agents.

Useful patterns:

- **Tool-using agent**: one agent uses several MCP servers.
- **Planner agent**: one configured Dynamic Agent plans a task and calls tools as needed.
- **Composable agents**: Dynamic Agents can reference subagents when the deployment enables that pattern.
- **Knowledge-backed agent**: an agent combines tool calls with RAG retrieval.

### MCP Servers

MCP servers expose tools through a standard protocol. In this repo, first-party MCP servers live under:

```text
ai_platform_engineering/mcp
```

The shared local build path is:

```text
build/agents/Dockerfile.mcp
```

The workshop starts `mcp-netutils` as an example tool server.

## Start the Stack

From the repository root:

```bash
docker compose -f workshop/docker-compose.mission3.yaml up -d --build
```

Open:

- CAIPE UI: [http://localhost:3000](http://localhost:3000)
- Dynamic Agents health: [http://localhost:8100/healthz](http://localhost:8100/healthz)

Check containers:

```bash
docker compose -f workshop/docker-compose.mission3.yaml ps
```

## Configure an Agent

In the CAIPE UI:

1. Open **Admin**.
2. Open **MCP Servers**.
3. Add a server:
   - ID: `netutils`
   - Name: `NetUtils`
   - Transport: `http`
   - Endpoint: `http://mcp-netutils:8000/mcp`
4. Open **Dynamic Agents**.
5. Create an agent:
   - Name: `Network Helper`
   - Model: select a configured model for your lab environment.
   - System prompt: `Help diagnose network connectivity and DNS issues.`
   - Allowed tools: enable `netutils`.
6. Start a chat with the new agent.

Try:

```text
Check if google.com is reachable.
```

```text
Resolve api.github.com and summarize the result.
```

## Direct MCP Check

Mission 2 starts only the MCP server:

```bash
docker compose -f workshop/docker-compose.mission2.yaml up -d --build
docker compose -f workshop/docker-compose.mission2.yaml ps
```

Use this when you want to test MCP server build and startup without the UI or Dynamic Agents.

## Local Development Override

For hot reload while using the main dev compose file:

```bash
docker compose \
  -f docker-compose.dev.yaml \
  -f workshop/docker-compose.dev.override.yaml \
  --profile workshop-dev \
  up -d --build
```

The override targets current services only:

- `caipe-ui`
- `dynamic-agents`
- `mcp-netutils`
- `rag-server`

## Clean Up

```bash
docker compose -f workshop/docker-compose.mission3.yaml down
```

## Summary

You ran the current CAIPE local stack and configured a Dynamic Agent to use an MCP tool server. Continue to [RAG and Git Agents](/docs/workshop/rag) to add knowledge retrieval and GitHub tooling.
