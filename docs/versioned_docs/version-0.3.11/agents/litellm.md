# LiteLLM MCP Server

The LiteLLM MCP server exposes read-only LiteLLM proxy data to CAIPE dynamic
agents. It is mainly intended for FinOps reporting, model inventory, key lookup,
usage, spend, users, teams, projects, and health checks.

Unlike the standard platform sub-agents, LiteLLM is deployed as a standalone MCP
server for dynamic agents. There is no matching A2A sub-agent image.

## What It Provides

- Generated read-only LiteLLM API tools from `openapi-mcp-codegen`
- Curated FinOps report tools that avoid slow raw spend-log pagination
- Month and CAIPE business-quarter reporting helpers
- Markdown and HTML report payloads that can be written to the existing Files section

## Dev Deployment

For PR testing, use a `prebuild/*` branch so CI publishes prebuild images for
both the MCP server and dynamic agents runtime:

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

The `litellm-mcp-secret` Secret must contain `LITELLM_API_KEY`.

## Prod Deployment

Prod should use released images and chart versions, not prebuild images:

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

Use External Secrets or the platform secret manager for `LITELLM_API_KEY` in
shared environments.
