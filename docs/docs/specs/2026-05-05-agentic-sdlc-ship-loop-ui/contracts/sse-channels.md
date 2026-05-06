# SSE Channels Contract — Ship Loop

The Ship Loop UI uses Server-Sent Events for live updates. Two channels are exposed; both honor the same gating rules as the HTTP API (server toggle + user flag + repo authz).

Implementation reuses `ui/src/lib/sse-streaming-client.ts` and the streaming patterns under `ui/src/lib/streaming/`.

## Channel 1 — Per-Epic stream

**Endpoint**: `GET /api/ship-loop/repos/{owner}/{repo}/epics/{epicId}/events`
**Content-Type**: `text/event-stream`

### Events emitted

| `event:` | `data:` payload | When emitted |
|----------|-----------------|--------------|
| `connected` | `{ "epic_id": "...", "server_time": "ISO" }` | Right after handshake |
| `artifact_upserted` | One `ShipLoopArtifact` JSON | When projector updates any child of this Epic |
| `event_appended` | One sanitized `ShipLoopEvent` JSON (without raw `payload` field for non-admin viewers) | When a new event is persisted |
| `stage_transition` | `{ "artifact_id": "...", "from": "implement", "to": "review_hitl", "reason": "..." }` | When an artifact's stage changes |
| `webhook_health` | `{ "status": "healthy" \| "degraded" \| "missing", "last_event_at": "ISO" }` | Periodic + on health change |
| `heartbeat` | `{ "t": "ISO" }` | Every 25s to keep proxies/load-balancers from idling out |
| `error` | `{ "code": "...", "message": "...safe text..." }` | On a recoverable server error before close |

The client must tolerate out-of-order arrival of `event_appended` and `artifact_upserted` (the projector may emit them in either order). UI state is reconciled by `current_stage` on the artifact, not by the order of events.

### Closing

Server may close on:
- Caller's session expiring (401).
- Feature disabled mid-session (`SHIP_LOOP_ENABLED` flipped to false): server emits a final `error` with `code="feature_disabled"` and closes 1000.
- Caller losing repo access: closes with `code="access_revoked"`.

## Channel 2 — Needs-you inbox

**Endpoint**: `GET /api/ship-loop/needs-you`
**Content-Type**: `text/event-stream`

A single per-user firehose of artifacts that require the caller's review/approval across **all** repos visible to them.

### Events emitted

| `event:` | `data:` payload | When emitted |
|----------|-----------------|--------------|
| `connected` | `{ "user_id": "...", "server_time": "ISO" }` | Handshake |
| `inbox_added` | `{ "artifact_id": "...", "owner": "...", "repo": "...", "title": "...", "stage": "review_hitl", "since": "ISO" }` | When a new artifact enters the user's "needs you" set |
| `inbox_removed` | `{ "artifact_id": "..." }` | When the user is no longer a requested reviewer / when the artifact moves past review |
| `inbox_initial` | `{ "items": [ ...same shape as inbox_added... ] }` | Sent once after `connected` to seed the client |
| `heartbeat` | `{ "t": "ISO" }` | Every 25s |
| `error` | `{ "code": "...", "message": "..." }` | On recoverable error |

## Cross-cutting

- **Cardinality limits**: max 10 concurrent SSE connections per user across both channels combined; server returns `429` with `Retry-After` if exceeded. (Defends against runaway clients; pilot-scale users will not hit this.)
- **Untrusted fields** (`title`, body excerpts, comments) are sanitized server-side before emission and re-sanitized client-side at render. The raw `payload` field on `ship_loop_events` is **never** sent on these channels — only the projected, safe summary.
- **Backpressure**: server-side queues per connection are bounded (default 256 events); on overflow the server closes with `code="overflow"` and the client must reconnect (will receive a fresh full state via the per-Epic GET or a fresh `inbox_initial`).
- **Reconnection**: clients should set `EventSource.onerror` to back off (1s, 2s, 4s, capped at 30s) and resume.
