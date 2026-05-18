# LiteLLM MCP Server

The LiteLLM MCP server exposes read-only LiteLLM proxy data to CAIPE dynamic
agents. It is mainly intended for FinOps reporting, model inventory, key lookup,
usage, spend, users, teams, projects, and health checks.

Unlike the standard platform sub-agents, LiteLLM is deployed as a standalone MCP
server for dynamic agents. There is no matching A2A sub-agent image.

## What It Provides

- Generated read-only LiteLLM API tools from `openapi-mcp-codegen`
- Curated FinOps report tools that avoid slow raw spend-log pagination
- A report request form helper for Dynamic Agents chat, using the built-in
  `request_user_input` HITL form tool
- Month and CAIPE business-quarter reporting helpers
- HTML chart and CSV report payloads that can be written to the existing Files section

## FinOps Agent Form Flow

Keep the Dynamic Agents built-in `request_user_input` tool enabled for the
FinOps agent. When a user asks for a report without enough details, such as
"give me a LiteLLM report", default to the chat form instead of guessing or
asking a plain text follow-up. Call `get_litellm_report_request_form`, then pass
its `form_request.prompt` and `form_request.fields` to `request_user_input` so
the user can choose the report type, period, and optional model, user, or
token/API key filter in the form.

The compact form collects the report type, fiscal or custom date range, and one
optional filter. After the user submits it, call the matching curated report
tool with `report_format: "html_csv"` and write every returned
top-level `files_to_write` item so users get the visual HTML report and CSV
export in Grid Files. The HTML report uses the shared
`litellm-finops-html-v2` template; do not create a new HTML template in the chat
model.

For the chat answer itself, use the report tool's `chat_response.default_markdown`
by default. This gives the user a dashboard-style Markdown report with a KPI
snapshot, Visual Snapshot, and detailed tables, instead of prose-only summaries
or numbered lists. This chat visualization is required for every report request,
even when the user did not explicitly ask for graphs. Do not draw graphs in chat
with repeated bar, dash, or block characters. When the user asks for a graph or
visualization, write the HTML report and mention that the visual graph is
available in Grid Files.

For "what can you do?" answers, call `get_litellm_report_request_form` with
`include_overview: true` and use `agent_overview_markdown`. The returned
overview is preformatted as a polished Markdown answer with lightweight
workflow image URLs, a workflow description, capability tables, a fiscal
calendar, supported filters, outputs, and example prompts. Keep it lightweight:
do not add base64 image data to the answer because large inline images make chat
streaming slow. Return the overview directly as the full answer; do not emit any
visible text before it or prepend conversational lead-in text.

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
