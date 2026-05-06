# Ship Loop server-side library

Server-only modules for the Agentic SDLC Ship Loop feature.

- `guard.ts` — `withShipLoopGate` middleware (404 when feature off).
- `mongo-collections.ts` — typed wrappers over `getCollection` for the three new collections.
- `github-client.ts` — Octokit wrapper with permission cache.
- `webhook-verify.ts` — HMAC SHA-256 verification.
- `stage-resolver.ts` — pure function deriving `current_stage` from events.
- `projection-worker.ts` — bounded async worker that projects events → artifacts.
- `webhook-health.ts` — periodic webhook idle-detection.
- `sse-bus.ts` — in-process pub/sub keyed by Epic id and user id.
- `sli.ts` — observability counters/gauges.
- `authz.ts` — `requireRepoRead/Triage/Write/Admin` (returns 404, not 403).
- `assistant-guard.ts` — rejects mutating tool calls from the AG-UI assistant.

**None** of these modules are safe to import from client components.
