# mcp_webex_meetings

Local MCP server that exposes the Webex Meetings / Transcripts / Recordings REST
API as MCP tools. Designed as a **drop-in replacement** for Cisco's official
Webex Meetings MCP (`https://mcp.webexapis.com/mcp/webex-meeting`) — same tool
names, same arguments — so the day Cisco enables agentic apps in the cisco.com
Control Hub, this server can be deleted and the dynamic-agent's MCP URL pointed
at the official endpoint with no other code changes.

## Authentication

Per-user OAuth bearer, forwarded through MCP request headers.

The dynamic-agents runtime (`mcp_client._resolve_user_oauth_headers`) injects
`Authorization: Bearer <user-token>` on every request, where the token is
resolved from the `vendor_connections` Mongo collection (populated by the UI's
`/settings/integrations/webex` OAuth flow).

This MCP server simply pulls the inbound `authorization` header off the
incoming request and forwards it to `https://webexapis.com/v1/...`. No token
storage, no Mongo access, no refresh logic — that's all handled by the runtime.

## Tools

Mirrors Cisco's official Meetings MCP tool surface:

- `webex_list_meetings` — list/search meetings with date filters
- `webex_get_meeting_status` — get a meeting + optional participants
- `webex_create_meeting` — schedule a meeting
- `webex_update_meeting` — patch a meeting
- `webex_delete_meeting` — delete a meeting
- `webex_list_recordings` — list recordings
- `webex_list_transcripts` — list transcripts (and optionally inline-download VTT)
- `webex_get_meeting_summary` — Webex AI–generated summary (best-effort)

## Run locally

```bash
uv run mcp-server-webex-meetings --transport streamable-http --port 8000 --host 0.0.0.0
```

Tools are then reachable at `http://localhost:8000/mcp/`.
