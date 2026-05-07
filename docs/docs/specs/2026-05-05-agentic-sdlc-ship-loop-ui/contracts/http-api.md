# HTTP API Contract — Ship Loop

All routes live under `ui/src/app/api/agentic-sdlc/**` and follow the existing CAIPE Next.js route-handler conventions. Every route enforces:

1. **Server-side toggle**: if `Config.shipLoopEnabled === false`, return **`404 Not Found`** with empty body. Do not branch on Authorization header before this check.
2. **Authentication**: requires a valid `next-auth` session (via existing `api-middleware.ts`). Otherwise `401`.
3. **Per-user feature flag**: if the caller's `ship_loop_enabled` user preference is `false`, return **`404`**. (The flag is read server-side from the user record; we do not trust a client header.)
4. **Authorization**: for repo-scoped routes, verify GitHub repo access via the user's GitHub OAuth token; cache 5 min. Failures return **`404`** (not 403) to avoid feature-existence disclosure.

Request/response bodies are JSON unless noted. All times are ISO-8601 UTC. Errors follow the existing repo convention: `{ "error": "<code>", "message": "<safe text>" }`.

---

## `GET /api/agentic-sdlc/repos`

List repos onboarded by the calling user (or visible to them).

**Response 200**
```json
{
  "items": [
    {
      "repo_id": "1234567",
      "owner": "cisco-outshift",
      "name": "ai-platform-engineering",
      "full_name": "cisco-outshift/ai-platform-engineering",
      "sandbox_environment": "sandbox-eks",
      "webhook_status": "healthy",
      "counts": {
        "open_epics": 4,
        "in_flight_subtasks": 11,
        "prs_awaiting_review": 2,
        "deploys_24h": 6
      }
    }
  ]
}
```

## `POST /api/agentic-sdlc/repos`

Onboard a new repo.

**Request**
```json
{
  "owner": "cisco-outshift",
  "name": "ai-platform-engineering",
  "sandbox_environment": "sandbox-eks",
  "label_to_stage_overrides": { "agent:design": "specify" }
}
```

**Response 201** — same shape as `GET` item. **409** on duplicate active onboarding.

## `GET /api/agentic-sdlc/repos/{owner}/{repo}`

Repo detail + webhook health. **404** if not onboarded or caller lacks access.

## `POST /api/agentic-sdlc/repos/{owner}/{repo}/sync`

Reconcile current GitHub issue and pull request state into the derived artifact
store. Used after onboarding, on stale repo-detail reloads, and from the manual
"Refresh from GitHub" control when webhook forwarding may have missed events.
Pulls issues and PRs with `per_page=100`, stores UI-origin reconciliation
events in `ship_loop_events`, upserts projected rows in `ship_loop_artifacts`,
and updates `last_reconciled_at` on the repo.

**Response 200**
```json
{
  "synced": true,
  "repo": "cisco-eti/sri-react-app",
  "issues_seen": 42,
  "pull_requests_seen": 8,
  "artifacts_upserted": 47,
  "events_recorded": 47,
  "last_reconciled_at": "2026-05-07T08:30:00.000Z"
}
```

## `DELETE /api/agentic-sdlc/repos/{owner}/{repo}`

Offboard. Sets `offboarded_at`. Read-only state preserved (FR-004). Idempotent.

## `GET /api/agentic-sdlc/repos/{owner}/{repo}/epics`

List Epics. Supports `?stage=`, `?needs_me=true`, `?stalled=true`, `?limit=`, `?cursor=`.

**Response 200**
```json
{
  "items": [
    {
      "artifact_id": "I_kwDOAB1234",
      "title": "Add OAuth2 device flow",
      "current_stage": "implement",
      "needs_human": false,
      "stalled_since": null,
      "child_counts": { "subtasks": 5, "prs": 3, "deploys": 1 },
      "github_url": "https://github.com/cisco-outshift/.../issues/142",
      "last_event_at": "2026-05-05T20:14:33Z"
    }
  ],
  "next_cursor": null
}
```

## `GET /api/agentic-sdlc/repos/{owner}/{repo}/epics/{epicId}`

Full Epic view (Epic + every child sub-task, PR, deploy, recent events).

**Response 200**
```json
{
  "epic": { /* artifact */ },
  "subtasks": [ /* artifact[] */ ],
  "pull_requests": [ /* artifact[] */ ],
  "deploys": [ /* artifact[] */ ],
  "recent_events": [ /* event[] up to 100, newest first */ ],
  "needs_me": [ /* artifact_ids requiring caller's review/approval */ ]
}
```

## `GET /api/agentic-sdlc/repos/{owner}/{repo}/epics/{epicId}/events` *(SSE)*

Server-Sent Events stream for live updates. See [`sse-channels.md`](./sse-channels.md). Returns `text/event-stream`.

## `GET /api/agentic-sdlc/needs-you` *(SSE)*

Per-user "Needs you" inbox stream. See [`sse-channels.md`](./sse-channels.md).

---

## HITL action routes

All HITL routes are `POST` and require **write** permission on the target repo (verified via GitHub API).

Every successful action writes a `ship_loop_events` row with `source="ui"` recording actor, target, timestamp, and outcome.

### `POST /api/agentic-sdlc/actions/approve-pr`
```json
{ "owner": "...", "repo": "...", "pr_number": 42, "comment": "LGTM" }
```
On success: forwards to GitHub as `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with `event=APPROVE`.

### `POST /api/agentic-sdlc/actions/request-changes`
```json
{ "owner": "...", "repo": "...", "pr_number": 42, "comment": "Please address X" }
```
Forwards as `event=REQUEST_CHANGES`. **`comment` is required**.

### `POST /api/agentic-sdlc/actions/comment`
```json
{ "owner": "...", "repo": "...", "pr_number": 42, "comment": "..." }
```
Forwards as a PR review comment.

### `POST /api/agentic-sdlc/actions/retry-deploy`
```json
{ "owner": "...", "repo": "...", "deployment_id": 9876543 }
```
Forwards as `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs` (or equivalent — actual GitHub call resolved by the server based on which mechanism produced the deploy).

### `POST /api/agentic-sdlc/actions/pause-loop` / `POST /api/agentic-sdlc/actions/resume-loop`
```json
{ "owner": "...", "repo": "...", "epic_id": "I_kwDOAB1234" }
```
Adds/removes the `agent:paused` label on the Epic and on every open child sub-task. Persists a UI event.

---

## `POST /api/agentic-sdlc/webhooks/github`

Inbound GitHub webhook. **Public** (no session), but every request must:

1. Carry a valid `X-Hub-Signature-256` HMAC over the raw body, verified against the per-repo secret.
2. Carry an `X-GitHub-Delivery` header (used as idempotency key).
3. Originate from a GitHub-published source range when possible (best-effort; not strictly enforced because of corporate proxies).

Returns:
- **`202 Accepted`** is the **default** success response. The receiver verifies HMAC synchronously, enqueues the verified delivery to an in-process async worker, and returns. Synchronous response time is <100 ms p95 under pilot load. The actual DB write, projection into `ship_loop_artifacts`, and SSE fanout happen asynchronously inside the worker.
- `204 No Content` is returned only for unsubscribed event types or for deliveries from a no-longer-onboarded repo (silently discarded).
- `400 Bad Request` on malformed payload.
- `401 Unauthorized` on signature mismatch (never enqueued, never persisted).
- **`404 Not Found`** if `Config.shipLoopEnabled === false` (do not reveal that this URL exists).

Even though the response is async, **no verified delivery may be silently dropped**: if the in-process worker queue is at capacity, the receiver writes the raw verified event directly into `ship_loop_events` with `projection_status: "deferred"` and the projector retries on its next tick.

The server accepts only the event types listed in [`github-webhook-events.md`](./github-webhook-events.md); unknown event types are answered `204` and silently ignored, to avoid GitHub disabling deliveries for "unhandled" event types while we evolve.

---

## Error code summary

| HTTP | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created (onboarding) |
| 202 | Webhook accepted, projection deferred |
| 204 | Webhook accepted (no body), or idempotent no-op |
| 400 | Malformed payload |
| 401 | Signature mismatch (webhook only) or unauthenticated session |
| 404 | Feature disabled, repo not visible, or not found |
| 409 | Duplicate active onboarding |
| 429 | Rate-limited (forwarded from GitHub) |
| 500 | Server error |

---

## Security notes (cross-cutting)

- **Untrusted content**: any field originating from GitHub is treated as untrusted. The API trims/sanitizes `title` and `body_excerpt` server-side; the UI re-sanitizes on render with the existing `markdown-components.tsx` allow-list. No `dangerouslySetInnerHTML` of raw payloads. URLs are checked for safe schemes; `javascript:` and unknown schemes are stripped.
- **Secret handling**: webhook secrets are stored in the platform's secret manager / env, never in MongoDB. We persist only a SHA-256 hash for verification routing.
- **Rate limiting**: SSE connections capped per user (default 10 concurrent); HITL actions throttled per user-repo (default 30/min).
- **Audit**: every HITL action is recorded with actor, target, ip, user-agent, and outcome. Audit rows are immutable and not exposed via API outside of the per-Epic events view.
