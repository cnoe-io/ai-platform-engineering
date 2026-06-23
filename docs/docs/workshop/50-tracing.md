# Agent Tracing with Langfuse

## Overview

This part adds Langfuse to the current Docker Compose workshop stack.

Mission 7 starts:

- CAIPE UI on [http://localhost:3000](http://localhost:3000)
- Dynamic Agents on [http://localhost:8100](http://localhost:8100)
- NetUtils MCP server
- Langfuse on [http://localhost:3001](http://localhost:3001)
- Langfuse dependencies: PostgreSQL, ClickHouse, Redis, and MinIO

## Start the Stack

From the repository root:

```bash
docker compose -f workshop/docker-compose.mission7.yaml up -d --build
```

Check status:

```bash
docker compose -f workshop/docker-compose.mission7.yaml ps
```

Open:

- CAIPE UI: [http://localhost:3000](http://localhost:3000)
- Langfuse: [http://localhost:3001](http://localhost:3001)

## Create Langfuse Keys

In Langfuse:

1. Sign up with any local lab account.
2. Create an organization and project.
3. Open project settings.
4. Create API keys.
5. Copy the public and secret keys.

Restart Dynamic Agents with those keys:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-... \
LANGFUSE_SECRET_KEY=sk-lf-... \
docker compose -f workshop/docker-compose.mission7.yaml up -d --force-recreate dynamic-agents
```

Mission 7 sets:

- `ENABLE_TRACING=true`
- `LANGFUSE_HOST=http://langfuse-web:3000`

## Configure a Tool-Using Agent

In the CAIPE UI:

1. Add the NetUtils MCP server:
   - ID: `netutils`
   - Transport: `http`
   - Endpoint: `http://mcp-netutils:8000/mcp`
2. Create a Dynamic Agent:
   - Name: `Tracing Demo`
   - Model: select a configured model.
   - Allowed tools: enable `netutils`.
   - System prompt: `Use network diagnostic tools when they help answer the user.`

## Generate Traces

Ask:

```text
Check if google.com is reachable.
```

Then ask:

```text
Resolve api.github.com and summarize the DNS result.
```

## Inspect Traces

In Langfuse:

1. Open **Traces**.
2. Select the latest trace.
3. Inspect:
   - LLM generations.
   - Tool calls.
   - Latency.
   - Inputs and outputs.

If no trace appears:

- Confirm `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` were set when `dynamic-agents` started.
- Check `docker logs dynamic-agents`.
- Check `docker logs langfuse-web`.

## Clean Up

```bash
docker compose -f workshop/docker-compose.mission7.yaml down
```

Add `-v` only when you want to remove local Langfuse and MongoDB data:

```bash
docker compose -f workshop/docker-compose.mission7.yaml down -v
```

## Summary

You enabled tracing for the current Dynamic Agents runtime and inspected tool-using agent activity in Langfuse.
