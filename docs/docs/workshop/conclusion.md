---
sidebar_position: 6
---

# CAIPE Labs Conclusion

You completed the CAIPE Labs series using the current local architecture: CAIPE UI, Dynamic Agents, MCP servers, RAG services, and optional Langfuse tracing.

## What You Covered

| Part | Module | What you did |
|------|--------|--------------|
| 1 | [Introduction to AI Agents](/docs/workshop/agent) | Built a ReAct agent and exposed tools through MCP |
| 2 | [Multi-Agent Systems](/docs/workshop/mas) | Ran CAIPE UI, Dynamic Agents, MongoDB, and NetUtils MCP |
| 3 | [RAG and Git Tools](/docs/workshop/rag) | Added RAG, Milvus, and GitHub MCP tooling |
| 4 | [Tracing](/docs/workshop/tracing) | Added Langfuse and traced Dynamic Agent execution |

## Compose Reference

From the repository root:

```bash
docker compose -f workshop/docker-compose.mission2.yaml up -d --build
docker compose -f workshop/docker-compose.mission3.yaml up -d --build
docker compose -f workshop/docker-compose.mission4.yaml up -d --build
docker compose -f workshop/docker-compose.mission7.yaml up -d --build
```

Use one mission stack at a time unless you intentionally change host ports.

## Canonical Test Prompts

Use these after configuring the matching MCP servers and Dynamic Agent in the UI.

**Discover capabilities**

```text
What tools can you use?
```

**Network**

```text
Check if google.com is reachable.
```

**DNS**

```text
Resolve api.github.com and summarize the result.
```

**RAG**

```text
Tell me more about SLIM in AGNTCY and cite the retrieved source material.
```

**GitHub**

```text
Use GitHub tools to summarize open issues in my configured repository.
```

## Verification Checklist

- [ ] `docker compose ... config --quiet` passes for each workshop compose file.
- [ ] CAIPE UI opens at `http://localhost:3000`.
- [ ] Dynamic Agents health is reachable at `http://localhost:8100/healthz`.
- [ ] The configured Dynamic Agent can call the NetUtils MCP server.
- [ ] If RAG is enabled, `http://localhost:9446/healthz` is reachable and knowledge-base search works.
- [ ] If tracing is enabled, Langfuse opens at `http://localhost:3001` and receives traces after keys are configured.

## Clean Up

```bash
docker compose -f workshop/docker-compose.mission3.yaml down
docker compose -f workshop/docker-compose.mission4.yaml down
docker compose -f workshop/docker-compose.mission7.yaml down
```

Add `-v` only when you intentionally want to remove local data volumes.

## Next Steps

- Explore MCP servers under `ai_platform_engineering/mcp`.
- Create a custom Dynamic Agent in the CAIPE UI.
- Add a knowledge base and connect it through the Knowledge Base MCP server.
- Read the production deployment docs under [Getting Started](/docs/getting-started/quick-start).
