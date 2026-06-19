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
LITELLM_TOKEN_ALERTS_ENABLED=false
LITELLM_TOKEN_ALERT_THRESHOLD=0.8
LITELLM_TOKEN_ALERT_LIMITS_JSON={}
```

`LITELLM_TOKEN` and `LITELLM_API_TOKEN` are also accepted as compatibility aliases.

## Token Usage Alerts

The `evaluate_token_usage_alert` tool checks LiteLLM user daily activity reports
and returns whether a user or API key has reached the configured token-usage
threshold. It is disabled by default:

```bash
LITELLM_TOKEN_ALERTS_ENABLED=false
LITELLM_TOKEN_ALERT_THRESHOLD=0.8
```

While disabled, the tool still returns `notification.would_notify=true` when the
threshold is reached, but it does not send a notification. This is the intended
mode for local validation. Pass `param_token_limit` directly for one-off tests,
or configure repeatable limits with a JSON map:

```bash
LITELLM_TOKEN_ALERT_LIMITS_JSON='{"user@example.com":1000000,"default":500000}'
```

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
