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

- `get_litellm_report_request_form` - returns the Dynamic Agents chat form
  definition for report type, period/date range, and optional model, user, or
  token/API key filter. For "what can you do?" answers, call it
  with `include_overview: true` and use the returned
  `agent_overview_markdown`; it references lightweight workflow images by URL
  and avoids streaming large image payloads through the LLM.
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

Fiscal-year periods are also supported. The fiscal year runs from August 1
through July 31 and is named by the calendar year in which it ends. For example,
FY26 is August 1, 2025 through July 31, 2026:

- `FY26Q1` - August 1, 2025 through October 31, 2025
- `FY26Q2` - November 1, 2025 through January 31, 2026
- `FY26Q3` - February 1, 2026 through April 30, 2026
- `FY26Q4` - May 1, 2026 through July 31, 2026

Each curated report also includes a `visualizations` object with:

- `chat_response` - a top-level chat-answer helper with a dashboard-style
  Markdown report: KPI snapshot, chart snapshot, and detailed report tables.
  FinOps agents should use `chat_response.default_markdown` by default so
  answers are readable in chat and feel closer to the HTML report.
- `chart_data` - chart-ready bar data for top models/users.
- `markdown_tables` - chat-ready Markdown tables for the primary report rows.
- `chart_rendering_guidance` - reminds agents to keep chat output table-based
  and use the HTML report for visual graphs instead of ASCII/Unicode bars.
- `downloadable_reports` - Markdown, HTML, and CSV report templates. The FinOps agent
  can pass these `content` values to `write_file` so users can download reports
  from the existing Files section without requiring CAIPE UI chart changes.
- `files_to_write` and `file_write_status` - top-level guidance that reminds the
  FinOps agent that report templates are not visible in Grid until it calls
  `write_file`. By default, write every file in `files_to_write` so users get
  the visual HTML report and the CSV export. For HTML-only requests, pass
  `report_format: "html"` and then write the returned `/reports/*.html` entry
  before sending the final answer.
- `recommended_report_file` - the default visual HTML report with inline SVG
  graphs. The HTML uses the shared `litellm-finops-html-v2` template. FinOps
  agents should write this file exactly as returned for every report request,
  even when the user asks for a report without explicitly asking for graphs.
- `csv_report_file` - the default CSV export for spreadsheet-style analysis.
- `recommended_report_files` - the primary visual HTML report plus the CSV
  export. FinOps agents can iterate over this list when they only need the
  default downloads.

Recommended FinOps agent prompt rules:

- When asked "what can you do?", mention LiteLLM token reports, spend per
  LLM/model, user-level usage and spend, top model usage, available model
  inventory, downloadable HTML reports with visualization charts, and CSV
  exports. Mention that report requests can be started with a chat form, and
  mention supported fiscal periods such as `FY26Q1`. Call
  `get_litellm_report_request_form` with `include_overview: true` and use
  `agent_overview_markdown` exactly as returned. The final answer must start
  directly with the returned overview title; do not emit any visible text
  before it or prepend conversational lead-in text. Do not narrate the tool
  call. Do not add base64 image data to the answer; large inline images make
  chat streaming slow. Do not replace the returned overview with a plain bullet
  list; it is intentionally structured with a title, compact workflow image,
  vertical workflow description, capability tables, a fiscal calendar, filters,
  outputs, and example prompts.
- Keep the Dynamic Agents built-in `request_user_input` tool enabled. When the
  user asks for a report without enough details, such as "give me a LiteLLM
  report", default to the chat form instead of guessing or asking a plain text
  follow-up. Call `get_litellm_report_request_form` first and then call
  `request_user_input` with the returned `form_request.prompt` and
  `form_request.fields`. The compact form lets the user choose report type,
  fiscal or custom date range, and one optional model, user, or LiteLLM
  token/API key filter.
- After the form is submitted, normalize `report_type` by taking the value
  before ` - `. If `period` is `custom_date_range`, parse `custom_range` into
  `start_date` and `end_date`; otherwise call the selected report tool with
  `period`. If `filter_type` is `model`, `user_id`, or `api_key`, pass
  `filter_value` as that exact report tool argument.
- For every report request, call the relevant curated LiteLLM report tool with
  `report_format: "html_csv"` unless the user explicitly asks for a single
  format. This avoids sending unused Markdown report content through the model
  on every request.
- In the final chat answer, use `chat_response.default_markdown` by default so
  the user sees the KPI snapshot, Visual Snapshot, and detailed tables in chat.
  This is required for every report request, even when the user did not ask for
  graphs. Prefer this dashboard-style Markdown over numbered lists or plain
  text lists. Do not draw graphs in chat with repeated bar, dash, or block
  characters. When the user asks for a graph or visualization, write the HTML
  report and mention that the visual graph is available in Files.
- After the report tool returns, call `write_file` for every item in
  `files_to_write` so the HTML chart report and CSV export appear in Grid Files
  by default.
- Do not create a new HTML template in the chat model. Use the returned
  `files_to_write[*].content` exactly; the MCP server owns the shared report
  template so every report has the same layout and lower token overhead.
- Only say the reports are available in Files after every `write_file` call
  succeeds.

The generated OpenAPI tools include:

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
