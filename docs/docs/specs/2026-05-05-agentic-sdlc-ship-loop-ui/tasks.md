# Tasks: Agentic SDLC Ship Loop UI

**Input**: Design documents from `/docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/`
**Prerequisites**: `plan.md`, `spec.md` (US1..US7), `research.md`, `data-model.md`, `contracts/`, `mongodb-migration.md`, `quickstart.md`

**Tests**: Test tasks are included for the high-leverage seams (toggle gating, webhook HMAC + idempotency, stage resolver, async worker, authz). They are **not** exhaustive per the existing repo's test posture; we keep TDD where the cost of a regression is high (security + correctness boundaries).

**Organization**: Tasks are grouped by user story. **US1 (Onboarding) and US2 (Per-Epic visualization) are both P1 and together form the MVP.** US3..US6 are P2 increments. US7 is P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps task to a user story (US1..US7); only used inside user-story phases

## Path Conventions

This is a **Next.js web application** living entirely under `ui/`. Phase-1 plan also adds a small ops script under `ui/scripts/`. There is no Python work in MVP. All paths are absolute from repo root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, feature toggle plumbing, and dependencies.

- [X] T001 Add `shipLoopEnabled` (and `shipLoopAssistantEnabled`) to the `Config` interface and runtime resolution in `ui/src/lib/config.ts`; default `false`. Reads `SHIP_LOOP_ENABLED` and `SHIP_LOOP_ASSISTANT_ENABLED` env vars.
- [X] T002 [P] Document new env vars in `ui/env.example`: `SHIP_LOOP_ENABLED`, `SHIP_LOOP_ASSISTANT_ENABLED`, `GITHUB_WEBHOOK_SECRET`, `SHIP_LOOP_AGENT_BOT_LOGINS`, `SHIP_LOOP_ASSISTANT_AGENT_ID`.
- [X] T003 [P] Add `shipLoop` (and `shipLoopAssistant`) entries to `FEATURE_FLAGS` in `ui/src/store/feature-flag-store.ts` with `defaultValue: false`, `category: "developer"`, `preferencesKey: "ship_loop_enabled"` / `"ship_loop_assistant_enabled"`.
- [X] T004 [P] Install runtime deps in `ui/`: `@octokit/rest`, `@octokit/webhooks`, `@xyflow/react` (graph viz). Update `ui/package.json` and `ui/package-lock.json`.
- [X] T005 [P] Create the Ship Loop directory skeleton under `ui/src/`: `app/(app)/ship-loop/`, `app/api/ship-loop/`, `components/ship-loop/`, `components/ship-loop/visualizations/`, `hooks/`, `lib/ship-loop/`, `types/ship-loop.ts`. Add a `README.md` to each new component directory linking back to the spec.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Toggle gating, MongoDB collections, GitHub client, webhook receiver, async worker, stage resolver, SSE pub/sub, base auth helpers. **Every user story depends on these.**

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

### Toggle gating (security boundary)

- [X] T006 [P] Implement `useShipLoopFeature` hook in `ui/src/hooks/use-ship-loop-feature.ts` returning `enabled`, `assistantEnabled`, `disabledReason` based on `Config.shipLoopEnabled` AND the per-user feature flag.
- [X] T007 Implement `withShipLoopGate(handler)` server-side middleware in `ui/src/lib/ship-loop/guard.ts`. When `Config.shipLoopEnabled === false`, returns `404` with empty body. The per-user `ship_loop_enabled` pref is enforced inside individual user-facing routes / the layout (the receiver intentionally checks only the server gate, since GitHub has no per-user identity).
- [X] T008 Add `ui/src/app/(app)/ship-loop/layout.tsx` that calls `notFound()` when `Config.shipLoopEnabled === false`, and renders a "feature not enabled for your account" empty-state (`ShipLoopUserGate`) when the user flag is off.
- [X] T009 [P] Unit tests for the gate in `ui/src/__tests__/ship-loop/guard.test.ts`: 404 when server flag off (multiple env values), handler invoked when both on, `isShipLoopServerEnabled` mirrors env.

### MongoDB collections + indexes

- [X] T010 Define typed wrappers around `getCollection` for the three new collections in `ui/src/lib/ship-loop/mongo-collections.ts`: `getShipLoopReposCollection`, `getShipLoopEventsCollection`, `getShipLoopArtifactsCollection`. Mirrors the field shapes from `data-model.md`.
- [X] T011 [P] Implement the idempotent index creation script in `ui/scripts/create-ship-loop-indexes.ts` per `mongodb-migration.md` (all indexes for repos, events including `deferred_projection` partial index and the 90-day TTL, and artifacts).
- [X] T012 [P] Add an npm script `ship-loop:create-indexes` in `ui/package.json` that runs `ts-node --transpile-only scripts/create-ship-loop-indexes.ts`.

### Shared TypeScript types

- [X] T013 Author `ui/src/types/ship-loop.ts` with the entity types from `data-model.md`: `ShipLoopStage`, `OnboardedRepo`, `ShipLoopEvent` (including `projection_status`, `projection_attempts`), `ShipLoopArtifact`, `HitlActionPayload`, and the new `VelocityMetric` and `AgentRunRecord` types. Also exports `SHIP_LOOP_STAGES`, `DEFAULT_AGENT_LABEL_TO_STAGE`, and `SHIP_LOOP_COLLECTIONS` constants.

### GitHub integration

- [ ] T014 Implement `ui/src/lib/ship-loop/github-client.ts` — server-only Octokit wrapper that takes the user's session token and exposes `getRepoPermission(user, owner, repo)`, `listUserRepos(user)`, `createWebhook(...)`, `deleteWebhook(...)`, `approvePR(...)`, `requestChangesPR(...)`, `commentPR(...)`, `retryDeployment(...)`. Includes a 5-minute in-memory permission cache.
- [ ] T015 [P] Implement `ui/src/lib/ship-loop/webhook-verify.ts` — HMAC SHA-256 verification using `@octokit/webhooks`; takes raw body + per-repo secret; returns `{ valid: boolean, repoId: string }` without throwing on mismatch.
- [X] T016 [P] Unit tests in `ui/src/__tests__/ship-loop/webhook-verify.test.ts`: valid signature, invalid signature, missing header, wrong secret per repo.

### Async worker + stage resolver

- [X] T017 [P] Implement the **pure** `resolveStage(events, labels, githubState, overrides)` function in `ui/src/lib/ship-loop/stage-resolver.ts` per `data-model.md` "Stage resolution rules". No I/O.
- [X] T018 [P] Unit tests in `ui/src/__tests__/ship-loop/stage-resolver.test.ts` covering all four rule precedences, per-repo overrides, blocked transitions, and unknown-label fallback.
- [X] T019 Implement the in-process bounded async worker in `ui/src/lib/ship-loop/async-worker.ts` (renamed from `projection-worker.ts`). Per-repo FIFO ordering via in-memory queue, dedupes via `(repo_id, github_delivery_id)` at the receiver, projects derived state into `ship_loop_artifacts`, and emits to the in-process SSE pub/sub. Pure projection extracted into `ui/src/lib/ship-loop/projector.ts` for unit testing without the Mongo driver.
- [~] T020 **PARTIAL** — failed-projection bookkeeping (`projection_status: "failed"`) is in place, but the periodic retry loop is deferred to T097-class polish; first-pass relies on the worker draining live + manual reset.
- [X] T021 [P] Unit tests in `ui/src/__tests__/ship-loop/projector.test.ts` covering pull_request / issues / deployment_status projection including override priority, sandbox-env filter, blocked-on-deploy-failure path, and unmodelled-event passthrough.

### Webhook receiver (shared route)

- [X] T022 Implement `POST /api/ship-loop/webhooks/github` in `ui/src/app/api/ship-loop/webhooks/github/route.ts`. Reads raw body, looks up repo by `repository.id`, verifies HMAC against per-repo secret, enqueues to the async worker, returns **`202 Accepted`**. Returns `204` for unsubscribed event types, `404` for unknown repos or when the server flag is off, `401` on bad signature, `400` on malformed body.
- [~] T023 **PARTIAL** — current implementation enqueues to the in-memory worker which has no overflow path; if the queue ever became saturated under pilot load the route would still persist the event with `projection_status: "deferred"` (it does so always before enqueueing). True back-pressure tuning lands in polish.
- [~] T024 **DEFERRED** — full route integration test requires Mongo Memory Server harness; gated under polish (T097-class). Verifier and projector tests cover the core branches.

### SSE pub/sub baseline

- [X] T025 Implement `ui/src/lib/ship-loop/sse-bus.ts` — in-process pub/sub keyed by `epic:<repo>:<epic>` and `inbox:<user>`, with bounded per-connection queues (default 256), overflow-close semantics, per-user 10-connection cap, and 25s heartbeats.
- [X] T026 [P] Adapt `ui/src/lib/sse-streaming-client.ts` patterns into `ui/src/hooks/use-ship-loop-stream.ts`. Implements the documented reconnect ladder (1s, 2s, 4s, ..., capped at 30s) and terminal-error short-circuit (`feature_disabled`, `access_revoked`).

### Observability SLIs (per Q5)

- [X] T027 [P] Implement four counters/gauges in `ui/src/lib/ship-loop/sli.ts`: webhook outcome counter, worker queue depth gauge, projection latency histogram, SSE active connection gauge. Wired into the receiver, the worker, and the SSE bus.
- [ ] T028 [P] Expose the SLIs through the existing `useCAIPEHealth` surface (deferred to Chunk D — operator UX).

### Authz helper

- [X] T029 Implement `ui/src/lib/ship-loop/authz.ts` — `resolveRepoPermission()` plus `requireRepoPermission(opts, "read"|"comment"|"admin")` returning 404 on no-access (to avoid leaking repo existence) and 403 on insufficient-permission. Backed by GitHub repo metadata via `github-client.ts`, results cached 60s per (user, repo).

**Checkpoint**: Foundation ready — every user-story phase below can now begin.

---

## Phase 3: User Story 1 — Onboard a repository to the Ship Loop (Priority: P1) 🎯 MVP

**Goal**: Authenticated users can onboard a GitHub repo, the system registers a webhook, and the repo appears on the Ship Loop home with health status.

**Independent Test**: Spec US1 acceptance scenarios 1–3 — onboard a repo end-to-end, see the repo card with counts within 5 s, and reproduce the "webhook unhealthy" banner with one-click reconnect.

### Tests for User Story 1

- [ ] T030 [P] [US1] Integration test for onboarding flow in `ui/src/__tests__/ship-loop/onboard-flow.test.ts` — list eligible repos, POST /repos, verify Mongo row, assert webhook creation called.
- [ ] T031 [P] [US1] Integration test for offboarding in `ui/src/__tests__/ship-loop/offboard-flow.test.ts` — DELETE /repos sets `offboarded_at`, live updates stop, historical data still readable.

### Implementation for User Story 1

- [~] T032 [P] [US1] **PARTIAL** — `GET /api/ship-loop/repos` ships in `ui/src/app/api/ship-loop/repos/route.ts` returning counts (open epics, in-flight subtasks, PRs awaiting review, deploys 24h) under the `{items: [...]}` envelope. Full GitHub-OAuth-backed visibility filter is deferred to FR-029 alongside repo authz.
- [ ] T033 [US1] Implement `POST /api/ship-loop/repos` in the same `route.ts` — verifies repo read access, creates GitHub webhook (or links existing), persists `OnboardedRepo` in Mongo, returns `201`. Handles `409` on duplicate active onboarding.
- [ ] T034 [P] [US1] Implement `GET /api/ship-loop/repos/{owner}/{repo}` in `ui/src/app/api/ship-loop/repos/[owner]/[repo]/route.ts` — repo detail + webhook health.
- [ ] T035 [US1] Implement `DELETE /api/ship-loop/repos/{owner}/{repo}` in the same route — sets `offboarded_at`, idempotent.
- [ ] T036 [P] [US1] Implement webhook health check job in `ui/src/lib/ship-loop/webhook-health.ts` — periodically (every 60s in pilot) scans `OnboardedRepo` and updates `webhook_status` to `degraded` when no events received within the configured idle threshold.
- [ ] T037 [P] [US1] Implement `useOnboardedRepos` hook in `ui/src/hooks/use-onboarded-repos.ts` (SWR-style cache + revalidate on focus).
- [X] T038 [P] [US1] Implement the nav tab pill in `ui/src/components/layout/AppHeader.tsx` — visible only when `useShipLoopFeature().enabled === true`. Mirrors the existing `ragEnabled` pattern.
- [X] T039 [P] [US1] `ShipLoopHome.tsx` now embeds the live `RepoGrid` (fetches `/api/ship-loop/repos`) between the hero animation and the stage tile legend. Empty / loading / error states are explicit and the error path links the operator at the SHIP_LOOP_ALLOW_NO_AUTH bypass + the seed script.
- [X] T040 [US1] Wire `ShipLoopHome` into `ui/src/app/(app)/ship-loop/page.tsx` (server component delegating to the client component).
- [ ] T041 [P] [US1] Implement `OnboardRepoDialog.tsx` in `ui/src/components/ship-loop/OnboardRepoDialog.tsx` — repo dropdown sourced from `listUserRepos`, sandbox-environment text input, label-mapping override JSON editor, submit calls `POST /api/ship-loop/repos`.
- [ ] T042 [P] [US1] Implement `WebhookHealthBanner.tsx` in `ui/src/components/ship-loop/WebhookHealthBanner.tsx` with one-click "Reconnect" calling a server action that recreates the webhook.
- [ ] T043 [US1] Implement `ui/src/app/(app)/ship-loop/onboard/page.tsx` route hosting `OnboardRepoDialog` for direct deep-links.

**Checkpoint**: A user can onboard a repo and see it on the Ship Loop home. Webhook health is observable. **MVP shippable when paired with US2.**

---

## Phase 4: User Story 2 — Per-Epic visualization end-to-end (Priority: P1) 🎯 MVP

**Goal**: User opens an Epic and sees every sub-task, PR, and deploy with current ship-loop stage. Updates live via SSE within 10 s of webhook receipt. At least 3 of 5 visualization modes (Pipeline, Kanban, Timeline) shipped per `plan.md`.

**Independent Test**: Spec US2 acceptance scenarios 1–4 — open an Epic, identify current stage, see new PR appear within 10 s, see "Needs you" highlight, watch deploy go through after merge.

### Tests for User Story 2

- [ ] T044 [P] [US2] Integration test in `ui/src/__tests__/ship-loop/per-epic-view.test.ts` — seed events → projector runs → API returns expected structure.
- [ ] T045 [P] [US2] SSE-channel test in `ui/src/__tests__/ship-loop/sse-epic-stream.test.ts` — connect, receive `connected`, then `artifact_upserted` after a webhook; verify `event_appended` does not include raw `payload`.

### Implementation for User Story 2

- [X] T046 [P] [US2] `GET /api/ship-loop/repos/{owner}/{repo}/epics/{epicId}` returns the bundle (epic, subtasks, pull_requests, deploys, recent_events, needs_me). Strips `payload` and `_id` from `recent_events` before emission.
- [X] T047 [US2] `GET .../epics/{epicId}/events` SSE stream emits the documented event names via the in-process `sse-bus`. Pre-checks Epic existence so typos / stale URLs fail fast instead of holding an empty stream open. Disposes the bus subscription on `req.signal.abort` so browser-tab-close does not leak subscribers and trip the per-user 10-conn cap.
- [X] T048 [P] [US2] `useEpicShipState` ships in `ui/src/hooks/use-epic-ship-state.ts` — fetches the detail bundle, layers the SSE stream events on top using documented reconciliation rules (artifact_upserted = replace-or-append in bucket; event_appended capped at 100; stage_transition is a no-op because artifact_upserted is canonical).
- [X] T049 [P] [US2] `EpicView.tsx` shell ships in `ui/src/components/ship-loop/EpicView.tsx` with header (StageBadge, GitHub link, "needs you" callout, live-stream status indicator) and Pipeline / Kanban / Timeline tabs.
- [X] T050 [P] [US2] `PipelineView.tsx` ships -- 8 stages laid out left-to-right (responsive 1/2/4/8 columns), each column tinted from its stage's `bgClass`, empty-column placeholders so layout doesn't collapse, footer roll-up of PRs / deploys / sub-tasks.
- [X] T051 [P] [US2] `KanbanView.tsx` ships -- three lanes (Implement / Review / Deploy). Deploy lane intentionally accepts `deploy` and `observe` stages because those are too short-lived to deserve their own lane and the operator instinctively expects rolled-out services to live there.
- [X] T052 [P] [US2] `TimelineView.tsx` ships -- chronological list of `recent_events` with relative timestamps, agent-vs-human actor icons, kind/id summary line, and an explicit empty state that links to the "first webhook" so a fresh demo never feels broken.
- [X] T053 [P] [US2] `StageBadge.tsx` (in `ui/src/components/ship-loop/visualizations/`) and the `ArtifactCard.tsx` agent-vs-human iconography helper satisfy FR-016. Agent inference uses `agent_labels.length > 0` from the projector.
- [X] T054 [US2] Visualization picker (Pipeline / Kanban / Timeline) wired into `EpicView.tsx` via local `useState`. Per-user persistence is deferred to T055.
- [ ] T055 [P] [US2] Per-user persistence of selected viz mode + filters in `ui/src/store/ship-loop-store.ts` (Zustand). Deferred -- not blocking the mock-webhook demo, and per-user persistence requires the real session-based path to be cleaner. Tracked under polish.
- [X] T056 [US2] Per-Epic Next.js page lives at `ui/src/app/(app)/ship-loop/[owner]/[repo]/epics/[epicId]/page.tsx` (note: chose `/ship-loop/[owner]/[repo]/...` over `/ship-loop/repos/[owner]/[repo]/...` for shorter URLs; the `/repos` segment is a backend-API concept, not a user-facing one).
- [X] T057 [P] [US2] Per-repo Epic list page lives at `ui/src/app/(app)/ship-loop/[owner]/[repo]/page.tsx` and renders `RepoEpicList.tsx` with inline stage / needs_human / stalled filters.
- [X] T058 [P] [US2] `GET /api/ship-loop/repos/{owner}/{repo}/epics` ships with `stage=` (validated against the closed enum -> 400 on typo), `needs_human=`, `stalled=`, and cursor pagination keyed on `(last_event_at desc, _id desc)` with strict-less tie breaking on identical timestamps.

**Checkpoint**: A user can open an Epic, switch among 3 viz modes, and watch live updates within the 10 s SLO. **MVP complete when paired with US1.**

---

## Phase 5: User Story 3 — Live portfolio dashboard (Priority: P2)

**Goal**: Cross-repo dashboard with counts by stage, "needs human" queue, and stalled-Epic highlighting; filters persist per user.

**Independent Test**: Spec US3 acceptance scenarios 1–3 — counts update live across two repos, stalled Epic surfaces with duration + reviewer, filters persist across reload.

### Tests for User Story 3

- [ ] T059 [P] [US3] Integration test in `ui/src/__tests__/ship-loop/portfolio-dashboard.test.ts` — seed multiple repos and Epics across stages; assert dashboard counts and stalled-detection.

### Implementation for User Story 3

- [ ] T060 [P] [US3] Implement portfolio aggregation query in `ui/src/lib/ship-loop/portfolio-query.ts` — uses `repo_stage_index` and `stalled_index` from `mongodb-migration.md`. Returns counts per stage, per repo.
- [ ] T061 [P] [US3] Implement `GET /api/ship-loop/portfolio` in `ui/src/app/api/ship-loop/portfolio/route.ts` for the dashboard payload (filters: repo[], owner, stage, needs_me, stalled).
- [ ] T062 [US3] Implement stalled-detection projector update inside `projection-worker.ts` — when an artifact's `current_stage` does not change for the configured threshold, set `stalled_since`.
- [ ] T063 [P] [US3] Implement `PortfolioDashboard.tsx` in `ui/src/components/ship-loop/PortfolioDashboard.tsx` — count tiles, stalled callouts, filters bar.
- [ ] T064 [US3] Implement filter persistence in `ship-loop-store.ts` (T055) and synchronize URL query params for shareable views.
- [ ] T065 [P] [US3] Implement `NeedsYouInbox.tsx` in `ui/src/components/ship-loop/NeedsYouInbox.tsx` and the SSE channel `GET /api/ship-loop/needs-you` per `contracts/sse-channels.md`.
- [ ] T066 [US3] Implement `ui/src/app/api/ship-loop/needs-you/route.ts` SSE handler emitting `connected`, `inbox_initial`, `inbox_added`, `inbox_removed`, `heartbeat` events.

**Checkpoint**: Cross-repo portfolio is live and filterable.

---

## Phase 6: User Story 4 — Switchable visualization modes (Priority: P2)

**Goal**: Add the remaining 2 of 5 modes (Dependency Graph + Ship-loop Radar) and a portfolio Heatmap.

**Independent Test**: Spec US4 acceptance scenarios 1–5 — switch among all 5 modes on the same Epic without losing state; all artifacts represented in each mode.

### Implementation for User Story 4

- [ ] T067 [P] [US4] Implement `DependencyGraphView.tsx` (mode D) in `ui/src/components/ship-loop/visualizations/DependencyGraphView.tsx` using `@xyflow/react`. Nodes: Epic, sub-tasks, PRs, deploys; edges: parentage. Color-coded by stage and `needs_human`.
- [ ] T068 [P] [US4] Implement `ShipLoopRadarView.tsx` (mode E) in `ui/src/components/ship-loop/visualizations/ShipLoopRadarView.tsx` — four-quadrant SVG (Specify / Execute / Verify / Deliver+Observe) with token positions.
- [ ] T069 [P] [US4] Implement `HeatmapView.tsx` (mode F) in `ui/src/components/ship-loop/visualizations/HeatmapView.tsx` for the **portfolio** view — repo × stage grid colored by activity. Wired into `PortfolioDashboard` (US3) as an optional layout.
- [ ] T070 [US4] Extend the visualization picker in `EpicView.tsx` (T054) to include modes D and E; ensure switching is state-preserving.

**Checkpoint**: All 5 Epic-level + 1 portfolio visualization modes ship.

---

## Phase 7: User Story 5 — HITL actions inline + AG-UI assistant panel (Priority: P2)

**Goal**: Approve / request-changes / comment / retry-deploy / pause-loop from inside the UI with full audit. Plus the **"Talk to the loop"** side panel using a preconfigured CAIPE Dynamic Agent over AG-UI (per Clarification Q1).

**Independent Test**: Spec US5 acceptance scenarios 1–5 — full HITL approval round-trip lands in GitHub + audit log; assistant streams a grounded answer; assistant cannot mutate state.

### Tests for User Story 5

- [ ] T071 [P] [US5] Integration test in `ui/src/__tests__/ship-loop/hitl-actions.test.ts` covering approve / request-changes / comment / retry-deploy / pause-loop happy paths and authz failures (404).
- [ ] T072 [P] [US5] Test that the assistant cannot mutate state in `ui/src/__tests__/ship-loop/assistant-readonly.test.ts` — server rejects any tool call that maps to a mutation route.

### HITL action routes

- [ ] T073 [US5] Implement `POST /api/ship-loop/actions/approve-pr` in `ui/src/app/api/ship-loop/actions/approve-pr/route.ts` — `requireRepoTriage`, forwards to GitHub, writes a `source: "ui"` event row.
- [ ] T074 [P] [US5] Implement `POST /api/ship-loop/actions/request-changes` in `ui/src/app/api/ship-loop/actions/request-changes/route.ts`. `comment` field is required; sanitize before forwarding.
- [ ] T075 [P] [US5] Implement `POST /api/ship-loop/actions/comment` in `ui/src/app/api/ship-loop/actions/comment/route.ts`.
- [ ] T076 [US5] Implement `POST /api/ship-loop/actions/retry-deploy` in `ui/src/app/api/ship-loop/actions/retry-deploy/route.ts` — `requireRepoWrite`; resolves the deployment's underlying mechanism (Actions run, etc.) and triggers a retry.
- [ ] T077 [P] [US5] Implement `POST /api/ship-loop/actions/pause-loop` and `.../resume-loop` in `ui/src/app/api/ship-loop/actions/pause-loop/route.ts` and `.../resume-loop/route.ts` — adds/removes the `agent:paused` label on the Epic and every open child sub-task.
- [ ] T078 [P] [US5] Implement `HitlActionBar.tsx` in `ui/src/components/ship-loop/HitlActionBar.tsx` with Approve / Request changes / Comment / Retry deploy / Pause+Resume buttons, gated client-side by capability flags from the API but **always re-enforced server-side**.

### "Talk to the loop" AG-UI panel (Clarification Q1)

- [ ] T079 [US5] Implement `GET /api/ship-loop/assistant/context/{epicId}` in `ui/src/app/api/ship-loop/assistant/context/[epicId]/route.ts` — returns the read-only Epic context (artifacts, recent events, current stage, webhook health) the Dynamic Agent will consume. Strips raw webhook payload and any secrets per FR-032.
- [ ] T080 [US5] Implement assistant tool-call rejection middleware in `ui/src/lib/ship-loop/assistant-guard.ts` — denies any AG-UI tool call whose target is a Ship Loop mutation route. Returns a structured rejection the agent can include in its reply.
- [ ] T081 [P] [US5] Implement `TalkToTheLoopPanel.tsx` in `ui/src/components/ship-loop/TalkToTheLoopPanel.tsx` — wraps `DynamicAgentChatPanel` with the Epic-scoped context payload, the `SHIP_LOOP_ASSISTANT_AGENT_ID` agent, and an explicit "read-only" UX hint above the input. Hidden when `Config.shipLoopAssistantEnabled === false` or when the per-user `shipLoopAssistant` flag is off.
- [ ] T082 [US5] Wire `TalkToTheLoopPanel` into `EpicView.tsx` as a collapsible right-side panel with a feature-flag-gated toggle.
- [ ] T083 [P] [US5] Sanitize assistant rendering using the existing `markdown-components.tsx` allow-list per FR-034.

**Checkpoint**: HITL actions are inline and audited; the assistant streams answers and cannot mutate state.

---

## Phase 8: User Story 6 — Repo & team velocity + token spend (Priority: P2)

**Goal**: Velocity panel with 5 trend metrics including agent token spend; per-Epic token-spend chip. $-cost is admin-only. Sourced from existing CAIPE telemetry — no new metrics store. (Clarifications Q6 + Q7.)

**Independent Test**: Spec US6 acceptance scenarios 1–7 — all five metrics render with deltas; token-spend chip on Epic header; $-cost masked for non-admins; "incomplete" marker when telemetry has gaps.

### Tests for User Story 6

- [ ] T084 [P] [US6] Integration test in `ui/src/__tests__/ship-loop/velocity-metrics.test.ts` — seed Epics with merge events, assert `epics_merged_per_week`, `median_time_in_stage`, `agent_vs_human_pr_ratio`, `median_hitl_queue_age` math.
- [ ] T085 [P] [US6] Authz test in `ui/src/__tests__/ship-loop/velocity-cost-masking.test.ts` — non-admin sees token counts but `$-cost` field absent / masked.

### Implementation for User Story 6

- [ ] T086 [P] [US6] Implement event-log-derived velocity computations in `ui/src/lib/ship-loop/velocity-compute.ts` (epics_merged_per_week, median_time_in_stage, agent_vs_human_pr_ratio, median_hitl_queue_age).
- [ ] T087 [US6] Implement token-spend correlation in `ui/src/lib/ship-loop/token-spend.ts` — reads from existing CAIPE telemetry (Langfuse via `ui/src/lib/langfuse.ts` and/or Dynamic Agent run records); correlates runs to Epic id via the agent's working metadata. Returns total tokens, prompt/completion split, model breakdown, $-cost. **Includes a `completeness` flag** when telemetry has gaps in the requested window.
- [ ] T088 [US6] Implement `GET /api/ship-loop/velocity` in `ui/src/app/api/ship-loop/velocity/route.ts` — `?scope=repo|team`, `?repo=`, `?team=`, `?window=7d|30d|90d`. Calls T086 + T087. **Strips `cost_usd` fields when caller fails `requireRepoAdmin`** per FR-V08; returns the same shape so client UI can simply hide the field.
- [ ] T089 [P] [US6] Implement `VelocityPanel.tsx` in `ui/src/components/ship-loop/VelocityPanel.tsx` — five tiles (epics-per-week, time-in-stage, agent-vs-human, hitl-age, token-spend) with WoW delta + sparkline + drill-through.
- [ ] T090 [P] [US6] Implement `EpicTokenSpendChip.tsx` in `ui/src/components/ship-loop/EpicTokenSpendChip.tsx` — total tokens + tokens-per-merged-PR; placed in the Epic header (FR-V09).
- [ ] T091 [P] [US6] Implement velocity drill-through navigation: clicking a tile lands on a filtered Epic list (for non-token tiles) or an `AgentRunRecord` list with deep-links to Langfuse traces (for the token tile).
- [ ] T092 [US6] Implement "incomplete window" UI treatment in `VelocityPanel.tsx` per FR-V05 — clearly mark windows where event-log retention or telemetry gaps render the metric partial.
- [ ] T093 [US6] Wire `VelocityPanel` into `PortfolioDashboard.tsx` (US3) and into the per-repo page (T057) for repo-scoped views.

**Checkpoint**: Velocity + token spend visible; $-cost gated to admins; no new metrics store.

---

## Phase 9: User Story 7 — Drill into agent thinking and harness signals (Priority: P3)

**Goal**: Power-user detail panel for any sub-task or PR showing chronological agent steps, CI/harness checks, and check outcomes.

**Independent Test**: Spec US7 acceptance scenarios 1–2 — open a sub-task with at least one CI check and one agent comment; see them in chronological order with links to logs.

### Implementation for User Story 7

- [ ] T094 [P] [US7] Implement `GET /api/ship-loop/repos/{owner}/{repo}/artifacts/{artifactId}/details` in `ui/src/app/api/ship-loop/repos/[owner]/[repo]/artifacts/[artifactId]/details/route.ts` — returns merged stream of GitHub events + agent progress notes + CI check results.
- [ ] T095 [P] [US7] Implement `ArtifactDetailsPanel.tsx` in `ui/src/components/ship-loop/ArtifactDetailsPanel.tsx` — chronological list with check status, links to logs, links to GitHub.
- [ ] T096 [US7] Wire `ArtifactDetailsPanel` into `EpicView.tsx` as a slide-over when an artifact card is clicked.

**Checkpoint**: Power-user drill-down works; the harness becomes visible.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, docs, and end-to-end validation across all stories.

- [ ] T097 [P] Sanitize all user/agent-supplied text fields end-to-end in `ui/src/lib/ship-loop/sanitize.ts` (titles, body excerpts, comments, assistant output) using the existing markdown allow-list. Re-render tests in `ui/src/__tests__/ship-loop/sanitize.test.ts`.
- [ ] T098 [P] Add per-route rate limiting on `/api/ship-loop/actions/**` (default 30/min per user-repo) and SSE-connection cap (default 10 per user) in `ui/src/lib/ship-loop/rate-limit.ts`.
- [ ] T099 [P] Add audit log retention review surface in `ui/src/components/ship-loop/AuditLogView.tsx` (admin-only) — read-only listing of `source: "ui"` events for a given repo.
- [~] T100 **PARTIAL** — `quickstart.md` end-to-end against a real GitHub repo with screenshots remains pending until full GitHub OAuth + webhook auto-registration land. The mock-webhook equivalent (`mock-webhook-flow.sh` + the new `mock-webhook-demo.md`) covers the same MVP demo loop end-to-end without GitHub access.
- [ ] T101 [P] Update `ui/README.md` with a "Ship Loop" section linking to the spec and the quickstart.
- [ ] T102 [P] Add a security review note in `docs/docs/changes/2026-05-05-agentic-sdlc-ship-loop-ui-security.md` covering: webhook HMAC verification, untrusted-content rendering, deny-by-default authz, 404-on-disabled, secret handling, $-cost gating.
- [ ] T103 [P] Run `npm run lint` and `npm run build` from `ui/` and fix any new violations.
- [ ] T104 [P] Run the targeted Jest suite (`npm run test -- ship-loop` from `ui/`) and confirm all newly added tests pass.
- [ ] T105 Run a manual penetration probe per SC-010: assert that disabling the feature returns 404 (not 403/500), that webhook deliveries with bad signatures are rejected, that non-admin users cannot see `cost_usd`, and that no untrusted GitHub content escapes the sanitizer.

---

## Phase 11: Mock-Webhook Demo Loop (MVP test target)

**Purpose**: Provide a self-contained demo path that doesn't require a real GitHub App / OAuth wiring — the operator can drive a complete Epic → sub-task → PR → approve → merge → deploy scenario locally, end-to-end, with HMAC-signed deliveries.

- [X] T106 Add `npm run ship-loop:seed-mock-repo` (`ui/scripts/seed-mock-repo.ts`) which idempotently inserts `repo_id=999900001` (`mock-org/mock-repo`) into `ship_loop_repos` with the well-known mock secret hash, and documents the label-override schema in `seed-mock-repo.md`.
- [X] T107 Add `SHIP_LOOP_ALLOW_NO_AUTH` server-side bypass in `ship-loop-auth.ts` so the new GET APIs work in non-production without dragging full NextAuth into the demo loop. Production rejects the env var entirely (defense-in-depth + the `Config.isProduction` check). Forbidden in production is asserted by the unit test in `ship-loop-auth.test.ts`.
- [X] T108 Add `ui/scripts/mock-webhook-flow.sh` end-to-end driver — full Epic→deploy scenario, signed deliveries, pre-flight health check that produces actionable error messages for the two most common misconfigurations (bypass not set → 401; seed not run → 404). Each delivery id is unique per invocation so re-runs do not collide on the idempotency index.
- [X] T109 Add demo-walkthrough doc `docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/mock-webhook-demo.md` covering: required env vars, dev-server prerequisites, command sequence, expected UI state at each step, troubleshooting matrix.
- [ ] T110 Capture annotated screenshots of the mock demo into `docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/walkthrough/` (deferred to T100-class polish; the walkthrough doc references frame numbers so screenshots can drop in later).

**Checkpoint**: Operator with no GitHub access can `npm run dev`, run two scripts, click through, and watch the live Pipeline / Kanban / Timeline views update from a fully-mocked deploy success.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies; can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1; **blocks every user story**.
- **Phase 3 (US1) + Phase 4 (US2)**: Both P1, both depend on Phase 2. **Together they are the MVP.** They can run in parallel staffing-wise but ship together.
- **Phases 5–8 (US3..US6)**: All P2, all depend on Phase 2; can run in parallel after MVP. US3 and US4 are loosely coupled (US4 mode F is wired into US3); US5 depends on US2's Epic view existing; US6 depends on US3 portfolio + US2 Epic header existing.
- **Phase 9 (US7)**: P3, depends on US2.
- **Phase 10 (Polish)**: Depends on which user stories are in scope for the cut.

### Within Each User Story

- Tests (where included) before implementation for the security/correctness seams (gating, webhook, resolver, authz, assistant-readonly, cost-masking).
- Models / types before services; services before route handlers; route handlers before client components.
- API routes before client hooks; hooks before components.

### Parallel Opportunities

- Phase 1: T002, T003, T004, T005 are independent.
- Phase 2: T006, T009, T011, T012, T015, T016, T017, T018, T021, T024, T026, T027, T028 are parallelizable; the worker (T019, T020) blocks the receiver (T022, T023). T010 blocks T019.
- Phase 3 (US1): T030, T031 in parallel; T032, T034, T036, T037, T038, T039, T041, T042 mostly parallelizable; T033 depends on T032; T040 depends on T039; T035 depends on T034.
- Phase 4 (US2): T044, T045 in parallel; T050, T051, T052, T053, T055, T058 in parallel; T054 depends on the three viz components and T055; T056 depends on T049.
- Phase 7 (US5): all 5 action routes parallelizable; assistant context (T079) and rejector (T080) before the panel (T081).
- Phase 8 (US6): T086, T087 parallel; T089, T090, T091 parallel after T088.

---

## Parallel Example: Foundational Phase

```bash
# After T010 (mongo-collections) lands, launch in parallel:
Task: "T015 webhook-verify.ts (HMAC SHA-256)"
Task: "T017 stage-resolver.ts (pure function)"
Task: "T025 sse-bus.ts (in-process pub/sub)"
Task: "T027 sli.ts (4 SLI counters/gauges)"

# Their unit tests can run in parallel too:
Task: "T016 webhook-verify.test.ts"
Task: "T018 stage-resolver.test.ts"
Task: "T021 projection-worker.test.ts (after T019)"
```

## Parallel Example: User Story 2 (Per-Epic visualization)

```bash
# All three MVP visualization components in parallel:
Task: "T050 PipelineView.tsx"
Task: "T051 KanbanView.tsx"
Task: "T052 TimelineView.tsx"

# Plus tests, store, picker glue:
Task: "T044 per-epic-view.test.ts"
Task: "T045 sse-epic-stream.test.ts"
Task: "T053 StageBadge.tsx"
Task: "T055 ship-loop-store.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2 only)

1. Phase 1: Setup (T001–T005).
2. Phase 2: Foundational (T006–T029) — **must complete fully before any user-story phase**.
3. Phase 3 (US1) + Phase 4 (US2) — together produce a usable Ship Loop tab where a user can onboard a repo and watch one Epic move through the stages live with three visualization modes.
4. **STOP and validate** against `quickstart.md` (T100) and SC-002 (10 s update p95).
5. Demo / dogfood with the harness team.

### Incremental Delivery Order

1. MVP (US1 + US2) → demo
2. + US3 (Portfolio dashboard) → demo
3. + US5 (HITL actions + AG-UI assistant) → demo (this is when the "talk to the loop" affordance lands)
4. + US6 (Velocity + token spend) → demo (managers / EMs)
5. + US4 (Dependency Graph + Radar + Heatmap modes) → demo
6. + US7 (Drill-down details) → demo
7. Phase 10: Polish (T097–T105) → GA cut.

### Parallel Team Strategy

After Phase 2 lands, ideal split for a 3-developer team:
- **Dev A**: US1 (Onboarding) → US3 (Portfolio dashboard).
- **Dev B**: US2 (Per-Epic + 3 viz modes) → US4 (remaining viz modes).
- **Dev C**: US5 (HITL + AG-UI panel) → US6 (Velocity + token spend).
- All converge on Phase 10 polish.

---

## Notes

- Every `/api/ship-loop/**` route must use `withShipLoopGate` (T007) and the appropriate `requireRepo*` helper (T029) — server-side, before any other logic.
- The webhook receiver MUST verify HMAC synchronously and persist asynchronously — see FR-010a/b and `research.md` §R3. No verified delivery may be silently dropped; on queue overflow, persist directly with `projection_status: "deferred"`.
- The assistant (US5) is **read-only**. Server enforces this via T080. Never trust the agent to honor it on its own.
- $-cost (US6) is gated server-side; the client UI is also expected to render gracefully when the field is absent — do not inflate this into client-side authz.
- Pre-existing patterns to reuse, not reinvent: `feature-flag-store` (T003), `getCollection` (T010), `markdown-components.tsx` (T097), `DynamicAgentChatPanel` + `@ag-ui/core` (T081), SSE primitives (T026), Langfuse (T087).
- Follow the repo's commit conventions: `feat(ship-loop): ...`, DCO sign-off (`-s`), branch already named per spec-kit.
