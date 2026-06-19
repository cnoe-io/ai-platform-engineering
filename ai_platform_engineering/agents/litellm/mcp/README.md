# LiteLLM MCP Server

This package exposes a read-only MCP interface for the CAIPE LiteLLM proxy at
`https://litellm.prod.outshift.ai`.

The server was generated with
[`cnoe-io/openapi-mcp-codegen`](https://github.com/cnoe-io/openapi-mcp-codegen)
from the LiteLLM OpenAPI document for version `1.83.10`, using a curated set of
GET endpoints for management, inventory, health, spend, audit, and usage data.

## Setup

Create an MCP environment file:

```bash
cp .env.example .env.mcp
```

Then set a LiteLLM admin or read-capable proxy token:

```bash
LITELLM_API_URL=https://litellm.prod.outshift.ai
LITELLM_API_KEY=
LITELLM_VERIFY_SSL=true
SERVER_NAME=LITELLM
```

`LITELLM_TOKEN` and `LITELLM_API_TOKEN` are also accepted as compatibility aliases.

## Running

Run with the shared MCP Makefile in stdio mode:

```bash
make run
```

Run in streamable HTTP mode:

```bash
make run MCP_MODE=HTTP MCP_HOST=0.0.0.0 MCP_PORT=18080
```

The direct uv entrypoint is also available:

```bash
uv run mcp-litellm
```

## Local Docker Compose Dev

Set the shared LiteLLM token in the repo-root `.env` file:

```bash
LITELLM_API_KEY=<token>
```

Then run the local dev compose service from the repo root:

```bash
docker compose -f docker-compose/docker-compose.litellm.dev.yaml up --build
```

Use one of these MCP URLs depending on where the client runs:

```text
http://localhost:18080/mcp/
http://mcp-litellm:8000/mcp/
```

Use `localhost` from your host machine. Use `mcp-litellm` from another service
running in the same Docker Compose network.

## Tools

The generated server registers 110 read-only tools, including:

- model and model group inventory
- key, user, team, organization, project, and customer lookup
- spend, tag, budget, and provider budget views
- health, cache, callback, and router status
- guardrail and policy usage summaries
- prompt, search tool, audit, and configuration views

## Testing

Run the local MCP package test target:

```bash
make test
```

## References

- [OpenAPI MCP Codegen](https://github.com/cnoe-io/openapi-mcp-codegen)
