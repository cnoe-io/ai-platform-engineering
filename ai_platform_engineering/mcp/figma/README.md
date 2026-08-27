# Figma MCP Server

This CAIPE MCP server exposes the Figma REST API over stdio or Streamable HTTP.
It supports file inspection, node rendering, comments, file versions, folders,
library components/styles, and developer resources.

## Authentication

For local tooling, generate a Figma personal access token with only the scopes
you need and set `FIGMA_ACCESS_TOKEN`. The default `FIGMA_AUTH_MODE=pat` sends
it in Figma's `X-Figma-Token` header. Set `FIGMA_AUTH_MODE=oauth` when the
configured token is a Figma OAuth access token.

When routed through CAIPE AgentGateway, the server prefers the per-caller
`X-CAIPE-Provider-Token` and sends it to Figma as an OAuth bearer token. If the
gateway supplies that header without a value, the request fails closed instead
of falling back to a shared token.

Recommended granular scopes for the read-only tools are:

- `current_user:read`
- `file_content:read`
- `file_comments:read`
- `file_metadata:read`
- `file_versions:read`
- `folders:read`
- `folder_metadata:read`
- `team_library_content:read`
- `file_dev_resources:read`

Add `file_comments:write` only if agents should post comments, and
`file_dev_resources:write` only if they should create developer resources.

## Run locally

```bash
cp .env.example .env
uv sync --all-groups
set -a; source .env; set +a
uv run python server.py
```

The HTTP MCP endpoint is `http://localhost:8000/mcp` by default. CAIPE's
Compose profile maps it to `http://localhost:18014/mcp`.

Figma's project endpoints are deprecated and limited for public OAuth apps, so
the server uses the newer v2 folder endpoints.
