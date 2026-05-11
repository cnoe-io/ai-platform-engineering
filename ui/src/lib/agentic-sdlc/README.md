# Ship Loop server-side library

Server-only modules for the Agentic SDLC Ship Loop feature.

## Status

| Module | Status | Purpose |
|---|---|---|
| `guard.ts` | landed | `withShipLoopGate` middleware (404 when feature off). |
| `mongo-collections.ts` | landed | typed wrappers over `getCollection` for the three Ship Loop collections. |
| `webhook-verify.ts` | landed | HMAC SHA-256 verification with constant-time compare. |
| `stage-resolver.ts` | landed | pure function deriving `current_stage` from labels + native state. |
| `projector.ts` | landed | pure GitHub-event-to-`ArtifactPatch` projection (no I/O — separate from the worker so it's unit-testable without the Mongo driver). |
| `async-worker.ts` | landed | in-process queue + drainer that owns the projector → upsert → SSE pipeline; persists `projection_status` transitions. |
| `sse-bus.ts` | landed | in-process pub/sub keyed by `epic:<repo>:<epic>` and `inbox:<user>`. Bounded queues, overflow close, 25s heartbeats, 10-connection-per-user cap. |
| `sli.ts` | landed | four required SLI surfaces (webhook outcomes, queue depth, projection latency histogram, active SSE connections). |
| `github-client.ts` | landed | thin Octokit wrapper with normalised `GitHubClientError` shape and the four ops the feature needs. |
| `authz.ts` | landed | `resolveRepoPermission` + `requireRepoPermission`; 404 on no-access (to not leak repo existence), 403 on insufficient permission, 60s cache. |
| `webhook-health.ts` | TBD | periodic webhook idle detection (depends on cron infra, deferred). |
| `assistant-guard.ts` | TBD | rejects mutating tool calls from the Agentic SDLC assistant (lands with US5). |

## Import rules

**None** of these modules are safe to import from client components. The
client side talks to them only through `/api/agentic-sdlc/**` routes and
the SSE channels. The two-layer toggle is enforced both:

1. server-side, via `guard.ts#isAgenticSdlcServerEnabled` and
   `withAgenticSdlcGate` (returns `404` when off), and
2. client-side, via `useShipLoopFeature()` (hides the nav tab when
   off).

## Testing

Pure modules (`stage-resolver`, `projector`, `webhook-verify`, `sli`,
`sse-bus`) have unit tests in `ui/src/__tests__/ship-loop/`. The
worker's queue/persistence side requires a Mongo harness and is exercised
via integration tests landing in Chunk C/D.
