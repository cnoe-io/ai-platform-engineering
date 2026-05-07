# Phase 0 Research — Agentic SDLC Ship Loop UI

This document resolves the technical unknowns identified in `plan.md`. Each item follows the format: **Decision · Rationale · Alternatives considered**.

## R1. Feature-toggle pattern: "entire feature under a toggle"

**Decision**: Two-layer toggle, mirroring the existing `ragEnabled` and `dynamicAgentsEnabled` precedent.

- **Layer A — server kill switch**: `SHIP_LOOP_ENABLED` env var (default `false`) → `Config.shipLoopEnabled` (set in `ui/src/lib/config.ts`, exposed to client via `window.__APP_CONFIG__` allow-list). When `false`:
  - The `(app)/ship-loop/**` route group `layout.tsx` calls `notFound()` → returns Next.js 404.
  - Every `/api/agentic-sdlc/**` route returns `404` (not `403`) to avoid disclosing feature existence to non-pilot users.
  - The nav tab in `AppHeader.tsx` is not rendered.
- **Layer B — per-user opt-in (pilot)**: Add `shipLoop` to `FEATURE_FLAGS` in `ui/src/store/feature-flag-store.ts` with `defaultValue: false`, category `developer`, `preferencesKey: "ship_loop_enabled"`. The nav tab and route guard show the feature only when `useFeatureFlagStore.isEnabled('shipLoop') === true`. The flag persists to MongoDB user preferences (existing `apiClient.updatePreferences` pipeline).

A user sees the feature only when **both** layers are on. Operators can globally disable with one env var; individual pilots can opt in without forcing rollout.

**Rationale**:
- Reuses two patterns the codebase already maintains; no new mechanism.
- Hard kill switch satisfies the "entire feature behind a toggle" requirement from the user's planning input.
- 404 (vs 403) when disabled is the existing convention — see how unauthenticated users hit `/dynamic-agents` routes.
- Per-user opt-in lets us run a small pilot without touching every operator's config.

**Alternatives considered**:
- *Single env-only toggle.* Rejected — works as a kill switch but doesn't enable safe pilot rollout.
- *Single per-user-only toggle.* Rejected — operators have no way to disable globally if a critical bug ships.
- *LaunchDarkly / Unleash / new flag service.* Rejected — YAGNI; the current Zustand + MongoDB-prefs pattern works and adds zero ops surface.

## R2. Visualization library choices

**Decision**: Reuse plain SVG + Tailwind/CSS Grid for four of the five visualization modes; introduce **`@xyflow/react`** (React Flow) only for the Dependency Graph mode (mode D, post-MVP).

- **Pipeline (mode A)** — horizontal flex row of stage cells with artifact tokens; pure CSS Grid + Tailwind.
- **Kanban (mode B)** — CSS Grid columns with sortable card list; Tailwind. No drag-and-drop in MVP (cards move automatically as agent events arrive).
- **Timeline (mode C)** — vertical/horizontal SVG axis with event markers; small custom SVG component, no library.
- **Dependency Graph (mode D)** — `@xyflow/react` for force-directed / DAG layout. ~50 KB gzip.
- **Ship-loop Radar (mode E)** — four-quadrant SVG with token positions; small custom SVG component.

**Rationale**:
- Worse-is-better: four of the five modes are simple enough that adding a viz framework would cost more than it saves.
- React Flow is the only mode where we need real graph layout, edge routing, and interaction; rolling our own is **not** worth it for one mode.
- React Flow has TypeScript types, MIT license, active maintenance, and is widely deployed.

**Alternatives considered**:
- *Full d3.js for everything.* Rejected — large surface area, imperative API; overkill for four simple modes.
- *Recharts / visx / nivo.* Rejected — designed for charts, not for "place tokens at stages" or graphs.
- *Mermaid / mermaid-js.* Rejected — great for static diagrams in docs, not for live-updating UI.
- *Cytoscape.js.* Rejected — heavier than React Flow, less idiomatic with React.

## R3. Webhook ingestion path

**Decision**: Single shared Next.js API route `POST /api/agentic-sdlc/webhooks/github` serves **every** onboarded repository. It verifies the HMAC **synchronously** and writes to MongoDB **asynchronously** via an in-process async worker.

Per-repo isolation is by **secret**, not by route: each onboarded repo has its own webhook secret (we store the SHA-256 hash in `ship_loop_repos.webhook_secret_hash`; the secret itself lives in the platform secret store). The receiver looks up the repo by `repository.id` from the parsed payload and re-derives the HMAC against that repo's secret. Mismatch → `401`, never enqueued.

Request lifecycle:

1. Read raw body (`await req.text()`); parse minimal envelope (`X-GitHub-Delivery`, `X-Hub-Signature-256`, `repository.id`).
2. Look up the onboarded repo by `repository.id`; if not onboarded (or offboarded), respond `204` and discard.
3. Verify `X-Hub-Signature-256` HMAC against the per-repo secret using `@octokit/webhooks`.
4. **Enqueue** the verified delivery to an in-process bounded async task queue (e.g., a simple `Promise`-based worker keyed by `repo_id` so per-repo events stay FIFO).
5. Return **`202 Accepted`** with `<100 ms p95` synchronous response time under pilot load.
6. The worker, asynchronously:
   1. `upsert` into `ship_loop_events` keyed by `(repo_id, github_delivery_id)` — duplicate redeliveries are no-ops.
   2. Project derived state into `ship_loop_artifacts` (resolve stage, link Epic→sub-task→PR→deploy via the rules in `data-model.md`).
   3. Publish to subscribed SSE channels (per-Epic + per-user "Needs you").

**Backpressure**: The async queue is bounded (default 1,024 in-flight). On overflow, the receiver **still verifies + persists the raw event** to `ship_loop_events` directly with `projection_status: "deferred"`, so no verified delivery is dropped; the projector picks deferred rows up on its next tick and projects them.

**Rationale**:
- One Next.js process already runs on every deployed UI replica — no new service.
- `@octokit/webhooks` is the maintained reference implementation of GitHub webhook signature verification.
- Async writes keep the receiver fast (well under GitHub's 10 s timeout) and decouple HMAC verification from DB latency / projection cost.
- One shared route + per-repo secret matches GitHub's own conventions and avoids route explosion.
- For pilot scale (≤200 events/day), in-process async + SSE pub/sub is sufficient and trivial. We keep the option of moving to Mongo change streams or a dedicated queue later **without changing the receiver's public contract**.

**Alternatives considered**:
- *Synchronous DB writes inside the receiver.* Rejected — couples receiver latency to DB latency; no resilience to a slow projector.
- *Separate Python FastAPI receiver.* Rejected — adds ops surface (deploy, monitor, secret distribution) for zero MVP value.
- *External webhook gateway (smee.io, AWS API Gateway).* Rejected — adds dependency; no benefit at pilot scale.
- *External queue / Mongo change streams from day one.* Deferred — straightforward to add at the worker boundary; not needed for pilot.
- *One route per repo.* Rejected — explosion of routes, no isolation benefit beyond what per-repo secrets already provide.

## R4. Live-updates transport

**Decision**: Server-Sent Events (SSE), one channel per Epic for the per-Epic view and one channel per user for the "Needs you" inbox. Implementation reuses the patterns in `ui/src/lib/sse-streaming-client.ts` and `ui/src/lib/streaming/`.

**Rationale**:
- Server-pushed only — no bidirectional need.
- SSE works through standard HTTP, no special infra (load balancers, CDNs).
- The codebase already has battle-tested SSE client and parser code.

**Alternatives considered**:
- *WebSocket.* Rejected — bidirectional features unnecessary; SSE is simpler.
- *Polling.* Rejected — won't meet the 10-second SLO at acceptable cost.
- *Long-poll.* Rejected — strictly worse than SSE in modern browsers.

## R5. Sandbox EKS deploy visualization

**Decision**: Read GitHub `deployment` and `deployment_status` webhook events for environments matching the per-repo "configured sandbox environment" string set at onboarding. No direct EKS / kubectl / Argo calls in MVP.

The "Deploy" stage transition fires when:
- A `deployment` event arrives whose `environment` matches the onboarded value, **and**
- The associated `deployment_status` reaches a terminal state (`success`, `failure`, `error`, `inactive`).

**Rationale**:
- GitHub already emits these events for any deploy that uses GitHub's deployment API or Actions environments.
- The UI is generic over environment names — no EKS-specific assumptions in code.
- Direct cluster integration is out of scope per spec ("Sandbox EKS is treated generically").

**Alternatives considered**:
- *Argo CD MCP integration to read app sync status.* Deferred — requires separate auth surface and is a different feature.
- *Polling kubectl from the UI server.* Rejected — credential surface, network surface, and ops complexity.

## R6. Idempotency and out-of-order webhook handling

**Decision**: Persist every webhook event verbatim with a unique compound key `(repo_id, github_delivery_id)`; derive current stage on read by replaying the per-artifact event sequence sorted by GitHub's `created_at` timestamp.

- Re-delivery: insert with `upsert` keyed on `(repo_id, github_delivery_id)`. Duplicates are no-ops.
- Out-of-order: derived state (current stage of an artifact) is a pure function of its event log. We cache the derived state per artifact in `ship_loop_artifacts.current_stage` for fast read, recomputed on every event insert.

**Rationale**:
- Event-sourcing the state is the simplest way to be correct under reordering and re-delivery.
- The compound index serves both idempotency (unique constraint) and the "fetch all events for an Epic" read pattern.

**Alternatives considered**:
- *Trust arrival order, mutate state in place.* Rejected — flapping under retries.
- *Distributed lock per artifact.* Rejected — overkill for pilot scale.

## R7. Authorization model

**Decision**: Reuse the existing `next-auth` session and the user's GitHub OAuth token (already required for other GitHub-touching features in the app). On every `/api/agentic-sdlc/**` call:

1. Authenticate the session via existing middleware (`api-middleware.ts`).
2. For repo-scoped routes, call GitHub `GET /repos/{owner}/{repo}` with the user's token to verify read access. Cache the result per `(user_id, repo_id)` for 5 minutes.
3. For HITL action routes (`approve-pr`, `request-changes`, `retry-deploy`, `pause-loop`), additionally verify the user has `triage` (review approval) or `write` (retry/pause) permission via `GET /repos/{owner}/{repo}/collaborators/{username}/permission`.
4. On any check failure, return `404` (not `403`) — same precedent as Layer A above.

**Rationale**:
- Single source of truth for repo permissions: GitHub.
- 5-minute cache balances freshness vs. rate-limit / latency.
- 404 avoids leaking which repos exist in the system.

**Alternatives considered**:
- *Mirror permissions into MongoDB on onboarding.* Rejected — drifts; doesn't reflect permission revocations.
- *Trust client claims.* Rejected — security violation per Constitution §VII.

## R8. Performance target validation

**Decision**: For the pilot scale (5–10 repos, ~20 active Epics, ~200 events/day), in-process projection and SSE pub/sub easily meet the <500 ms persist and <10 s end-to-end SLOs. No load testing infra changes required for MVP. Add k6 / Artillery scenarios when approaching the 12-month target.

---

All NEEDS CLARIFICATION items from the plan template are resolved. Proceed to Phase 1.
