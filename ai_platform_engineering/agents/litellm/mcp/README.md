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
LITELLM_API_TIMEOUT=120
LITELLM_VERIFY_SSL=true
SERVER_NAME=LITELLM
```

`LITELLM_TOKEN` and `LITELLM_API_TOKEN` are also accepted as compatibility aliases.
`LITELLM_API_TIMEOUT` is optional and defaults to 30 seconds. Use a larger value
for slower analytics endpoints such as spend logs.

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

## Helm Deployment

The parent `ai-platform-engineering` chart can deploy this MCP server as a
standalone Kubernetes service. Enable it with Helm values, then point CAIPE UI
at the in-cluster service.

Dev or prebuild values:

```yaml
litellmMcp:
  enabled: true
  image:
    repository: ghcr.io/cnoe-io/prebuild/mcp-litellm
    tag: "<prebuild-tag>"
  config:
    LITELLM_API_URL: "https://litellm.prod.outshift.ai"
    LITELLM_API_TIMEOUT: "120"
    LITELLM_VERIFY_SSL: "true"
  existingSecret: "litellm-mcp-secret"

dynamic-agents:
  image:
    repository: ghcr.io/cnoe-io/prebuild/caipe-dynamic-agents
    tag: "<prebuild-tag>"

caipe-ui:
  appConfig:
    mcp_servers:
      - id: litellm
        name: LiteLLM
        description: LiteLLM FinOps reporting tools
        transport: http
        endpoint: http://ai-platform-engineering-litellm-mcp:8000/mcp/
        enabled: true
```

If the Helm release name is not `ai-platform-engineering`, update the endpoint
host to match the rendered LiteLLM MCP Service name.

Prod values use released images instead of prebuild images:

```yaml
litellmMcp:
  enabled: true
  image:
    repository: ghcr.io/cnoe-io/mcp-litellm
    tag: "<release-version>"
  config:
    LITELLM_API_URL: "https://litellm.prod.outshift.ai"
    LITELLM_API_TIMEOUT: "120"
    LITELLM_VERIFY_SSL: "true"
  existingSecret: "litellm-mcp-secret"

dynamic-agents:
  image:
    repository: ghcr.io/cnoe-io/caipe-dynamic-agents
    tag: "<release-version>"

caipe-ui:
  appConfig:
    mcp_servers:
      - id: litellm
        name: LiteLLM
        description: LiteLLM FinOps reporting tools
        transport: http
        endpoint: http://ai-platform-engineering-litellm-mcp:8000/mcp/
        enabled: true
```

If the Helm release name is not `ai-platform-engineering`, update the endpoint
host to match the rendered LiteLLM MCP Service name.

Create `litellm-mcp-secret` with:

```bash
kubectl create secret generic litellm-mcp-secret \
  --from-literal=LITELLM_API_KEY='<token>'
```

In shared clusters, prefer External Secrets or the platform secret manager
instead of creating the Secret by hand.

## Tools

The server registers the generated read-only tools plus curated report helpers.
Use the curated helpers for agent-facing analytics so the agent does not try to
infer full reports from one raw page of spend logs.

Curated tools:

- `get_llm_token_usage_report` - returns token totals plus top models and users
  for a month, a two-month custom range, or a CAIPE business quarter.
- `get_llm_spend_by_model_report` - returns spend per model for a month, a
  two-month custom range, or a CAIPE business quarter.
- `get_llm_usage_and_spend_by_user_report` - returns token usage and spend per
  user, including each user's top models.
- `get_llm_top_models_report` and `get_llm_usage_by_user_report` - compatibility
  aliases for older FinOps prompts.

The curated reports use LiteLLM's aggregate `/user/daily/activity/aggregated`
endpoint month-by-month instead of raw paginated spend logs. Custom date ranges
are limited to two calendar months. Quarter reports use the CAIPE business
quarters: Aug-Oct, Nov-Jan, Feb-Apr, and May-Jul.

Each curated report also includes a `visualizations` object with:

- `chart_data` - chart-ready bar data for top models/users.
- `text_charts` - ASCII bar charts that can be pasted directly into chat.
- `downloadable_reports` - Markdown and HTML report templates. The FinOps agent
  can pass these `content` values to `write_file` so users can download reports
  from the existing Files section without requiring CAIPE UI chart changes.

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
