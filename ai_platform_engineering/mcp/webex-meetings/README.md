# mcp-webex-meetings

Local MCP server that exposes the Webex Meetings / Transcripts / Recordings REST
API as MCP tools. It mostly mirrors the official Webex Meetings MCP
(`https://mcp.webexapis.com/mcp/webex-meeting`), with two local fallback helpers
for stale/expired-series debugging.

## Authentication

Per-user OAuth bearer, forwarded through MCP request headers.

The dynamic-agents runtime resolves a caller-scoped Webex `provider_connection`
from the Credentials > Connected Apps store and injects the token on
`X-CAIPE-Provider-Token`. AgentGateway rewrites that header into
`Authorization: Bearer <user-token>` before forwarding to this MCP server.
For local/direct development, this MCP server also accepts
`X-CAIPE-Provider-Token` directly.

This MCP server simply pulls the inbound `authorization` header off the
incoming request and forwards it to `https://webexapis.com/v1/...`. No token
storage, no Mongo access, no refresh logic; that is all handled by the runtime
and credential service.

The built-in Webex OAuth connector requests the meeting schedule, participant,
recording, transcript, and related Webex scopes required by these tools. Users
with a Webex connection created before those scopes were added must reconnect
the app so Webex can grant the expanded scope set.

## Tools

Mirrors Cisco's official Meetings MCP tool surface, plus local fallback helpers:

- `webex_list_meetings` - list/search meetings with date filters
- `webex_userhub_calendar` - best-effort User Hub calendar read for upcoming external-calendar occurrences
- `webex_resolve_meeting_link` - resolve a Webex join/calendar link through `/v1/meetings` with secrets removed
- `webex_get_meeting_status` - get a meeting + optional participants
- `webex_create_meeting` - schedule a meeting
- `webex_update_meeting` - patch a meeting
- `webex_delete_meeting` - delete a scheduled meeting
- `webex_list_recordings` - list recordings
- `webex_list_transcripts` - list transcripts (and optionally inline-download VTT)

There is currently no `webex_get_meeting_summary` tool because Webex does not
publish a public meeting-summary REST endpoint. Use
`webex_list_transcripts(download=true)` and summarize the transcript instead.

`webex_userhub_calendar` intentionally uses the same per-user OAuth token against
the Webex User Hub calendar feed, for example
`https://cisco.webex.com/webappng/api/v1/mymeetings/calendarView`. Treat it as a
best-effort fallback when public `/v1/meetings` rows look stale or expired: it can
surface Office365/Google-backed future occurrences that the public Webex schedule
API does not expose as `scheduledMeeting` rows.

## Run locally

```bash
uv run python server.py --transport streamable-http --port 8000 --host 0.0.0.0
```

Tools are then reachable at `http://localhost:8000/mcp/`.
