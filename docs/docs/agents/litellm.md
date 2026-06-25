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

## Automatic Webex Token Alerts

LiteLLM token usage alerts can run automatically as an optional scanner sidecar
on the `litellmMcp` deployment. The scanner periodically evaluates configured
targets and sends Webex only when usage reaches the threshold.

```yaml
litellmMcp:
  enabled: true
  config:
    LITELLM_API_URL: "https://litellm.prod.outshift.ai"
    LITELLM_TOKEN_ALERTS_ENABLED: "true"
    LITELLM_TOKEN_ALERT_THRESHOLD: "0.8"
    LITELLM_TOKEN_ALERT_NOTIFICATION_CHANNEL: "webex"
    LITELLM_TOKEN_ALERT_ALLOWED_RECIPIENTS: "mouledel@example.com"
    LITELLM_TOKEN_ALERT_TARGETS_JSON: >-
      [{"user_id":"mouledel@example.com","token_limit":1000000,"recipient":"mouledel@example.com"}]
  tokenAlertScanner:
    enabled: true
    intervalSeconds: 3600
    dryRun: false
  existingSecret: "litellm-mcp-secret"
```

The same secret should include `LITELLM_API_KEY` and one Webex token variable:
`WEBEX_TOKEN`, `WEBEX_ACCESS_TOKEN`, or `WEBEX_INTEGRATION_BOT_ACCESS_TOKEN`.
The scanner writes sent-alert keys to an emptyDir-backed state file so repeated
scans do not notify the same target every interval.
