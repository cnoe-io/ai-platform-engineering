---
sidebar_label: Figma MCP
title: Figma MCP Server
---

# Figma MCP Server

CAIPE includes a custom Figma MCP server backed by the Figma REST API. It is
useful when the official Figma MCP endpoint is not available to your CAIPE
deployment or when you need a controlled, self-hosted tool surface.

## Start with Docker Compose

Add a Figma token to `.env` and start the server profile:

```bash
FIGMA_ACCESS_TOKEN=<token>
FIGMA_AUTH_MODE=pat
COMPOSE_PROFILES=figma,caipe-ui-prod,dynamic-agents
docker compose --profile figma up -d mcp-figma
```

The local MCP endpoint is `http://localhost:18014/mcp`. The bundled dynamic
agent seed configuration registers it as the `figma` server. Use the `mcp-servers`
profile to start it as part of the standard local stack.

For Kubernetes, enable the `mcp-figma` Helm tag and provide a Secret containing
`FIGMA_ACCESS_TOKEN`. Its AgentGateway route is `/mcp/figma`.

## OAuth and Figma supported-client access

CAIPE already has a Figma provider connection definition. To enable per-user
connections, create a Figma OAuth app in [Figma My Apps](https://www.figma.com/developers/apps)
and configure this callback:

```text
https://<your-caipe-host>/api/credentials/oauth/figma/callback
```

Set `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET`, and `FIGMA_REDIRECT_URI`, then
enable the CAIPE OAuth connector bootstrap. The implementation uses Figma's
required `https://api.figma.com/v1/oauth/token` token endpoint, HTTP Basic
client authentication, and `/v1/oauth/refresh` for refresh grants.

Figma distinguishes private OAuth apps from public apps. A private app is
usable by the associated organization without Figma review. A public app must
be submitted for review. For AI coding-tool integrations, Figma's REST API
scope documentation currently directs developers to the Figma MCP Server and
offers a waitlist for new MCP clients; CAIPE cannot submit that request from
the repository or bypass Figma's approval process. The self-hosted REST MCP
server is the available interim path.

## Tool groups and scopes

The server exposes file trees and nodes, image rendering URLs, file metadata,
version history, comments, v2 folders, components/styles, and developer
resources. Read-only use should request only the corresponding granular
scopes. Comment posting and developer-resource creation are separate write
tools and require `file_comments:write` or `file_dev_resources:write`.

Figma only permits access to files available to the authenticated user or
organization. Do not use the server to index or ingest files belonging to
other companies.
