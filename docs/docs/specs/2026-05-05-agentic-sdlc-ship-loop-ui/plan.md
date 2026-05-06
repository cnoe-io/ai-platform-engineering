# Implementation Plan: Agentic SDLC Ship Loop UI

**Branch**: `2026-05-05-agentic-sdlc-ship-loop-ui` | **Date**: 2026-05-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md`

## Summary

Add a new "Ship Loop" top-level tab in the CAIPE UI that lets a team onboard a GitHub repository and visualize the agentic SDLC ship loop end-to-end (Specify → Plan → Tasks → Implement → Review (HITL) → Merge → Deploy → Observe). The UI is event-sourced from GitHub webhooks (issues, PRs, comments, reviews, deployments) and agent-applied labels, persisted in MongoDB, and pushed to the browser via SSE for live updates. The user can switch between five visualization modes (Pipeline, Kanban, Timeline, Dependency graph, Ship-loop radar) and act on PRs/deploys inline (HITL).

**Per the user's planning input, the entire feature is gated behind a feature toggle.** The toggle has two layers, matching the existing `ragEnabled` / `dynamicAgentsEnabled` precedent in `ui/src/lib/config.ts`:

1. **Server-side kill switch**: `SHIP_LOOP_ENABLED` env var → `Config.shipLoopEnabled`. When `false`, the `/ship-loop` route is not rendered, the nav tab is hidden, and the API routes return 404. Default `false`.
2. **Per-user opt-in (pilot mode)**: `shipLoop` entry in `FEATURE_FLAGS` (Zustand `feature-flag-store`, persisted to user preferences in MongoDB). Gates the tab in the header and the route's outer guard. Default `false`.

A user only sees the feature when **both** flags are on. This gives operators a hard kill switch and lets pilot users opt in without forcing the rollout on the org.

## Technical Context

**Language/Version**: TypeScript 5.x (Next.js 16, React 19) for the UI; Python 3.11+ for any new agent/webhook receiver hooks (none required for MVP — see research).
**Primary Dependencies**:
- Frontend: Next.js App Router, React 19, Tailwind CSS, Zustand (state), Radix UI primitives (already in repo), `lucide-react` icons. Visualization libs: `@xyflow/react` (a.k.a. React Flow) for dependency graph, `d3-shape` + plain SVG for ship-loop radar/pipeline, plain CSS grid + Tailwind for Kanban and timeline. **No new heavyweight viz framework** — stay aligned with `worse is better`.
- API routes (Next.js): `next-auth` session (existing), `octokit` (`@octokit/rest`, `@octokit/webhooks`) for GitHub API + webhook signature verification.
- Streaming: Server-Sent Events (SSE) — same pattern already used in `ui/src/lib/sse-streaming-client.ts` and `ui/src/lib/streaming/`.
**Storage**: MongoDB (existing connection via `ui/src/lib/mongodb.ts → getCollection`). Three new collections: `ship_loop_repos`, `ship_loop_events`, `ship_loop_artifacts`. See `mongodb-migration.md`.
**Testing**: Jest + React Testing Library (UI) — config at `ui/jest.config.js`. ESLint via `ui/eslint.config.mjs`. No new Python tests required for MVP.
**Target Platform**: Modern evergreen browsers (existing CAIPE UI baseline). Server-side runs in the Next.js Node runtime that already serves the UI.
**Project Type**: Web application — feature lives entirely under `ui/` (Next.js App Router pages, components, API routes), with MongoDB as the persistence layer.
**Performance Goals**:
- Webhook → DB persisted in <500 ms p95.
- Webhook ingest → connected SSE client updates DOM in <10 s p95 (matches SC-002 in spec).
- Per-Epic view initial render in <1.5 s p95 with up to 50 sub-tasks / PRs / deploys.
- Portfolio dashboard handles 100 onboarded repos and 1,000 in-flight Epics without virtualization issues.
**Constraints**:
- **Feature toggle gating**: every entry point (nav tab, route, API routes, SSE channel) must check both `Config.shipLoopEnabled` (server) and the per-user `shipLoop` flag (client) before rendering or returning data. Disabled-state must return 404 from API routes (not 403) to avoid disclosing the feature's existence to non-pilot users.
- **Webhook security**: every inbound `/api/ship-loop/webhooks/github` request must verify `X-Hub-Signature-256` HMAC against a per-installation secret stored in MongoDB; reject unsigned/mismatched payloads (FR-025).
- **Untrusted content rendering**: all user/agent-supplied text from GitHub (titles, comments, branch names, labels) is treated as untrusted. Render via existing `markdown-components.tsx` + DOMPurify allow-list. No `dangerouslySetInnerHTML` of raw payloads. Encode attribute contexts and block `javascript:` URLs (FR-027, FR-028).
- **Authorization**: every API route checks the caller has GitHub read access to the requested repo (cached on the server), and HITL action routes additionally check write/triage access. Deny-by-default; return 404 for repos the user can't see.
- **No production deploys** are visualized or actionable (out of scope per spec).
**Scale/Scope**:
- Pilot target: 5–10 onboarded repos, ~20 active Epics, ~200 webhook events/day.
- 12-month target: 100 onboarded repos, 1,000 active Epics, ~50K events/day.
- Visualization modes shipped at GA: at least 3 of 5 (P1 = Pipeline + Kanban + Timeline; P2 = Dependency graph + Ship-loop radar).

## Constitution Check

Evaluated against `.specify/memory/constitution.md` v1.0.0.

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Worse is Better | ✅ | We reuse existing patterns (config-driven feature gating, Zustand `feature-flag-store`, MongoDB via `getCollection`, SSE streaming). No new heavyweight viz framework; we use a single graph lib for one mode and plain SVG/CSS for the rest. |
| II. YAGNI | ✅ | MVP ships 3 of 5 visualization modes (P1 stories); the other two are P2/follow-ups. We do **not** build agent harness UI, multi-VCS, or production deploy gating — explicitly out of scope. |
| III. Rule of Three | ✅ | We don't extract a generic "viz framework" yet; each mode is implemented concretely. Refactor only after a 3rd similar feature emerges. |
| IV. Composition over Inheritance | ✅ | Visualization modes are sibling React components fed by a shared selector hook (`useEpicShipState`). No class hierarchies. |
| V. Specs as Source of Truth | ✅ | Spec lives at `docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md`. This plan and downstream artifacts reference it. |
| VI. CI Gates Are Non-Negotiable | ✅ | Adds Jest tests for store, hooks, components; ESLint passes; no Python changes. |
| VII. Security by Default | ✅ | No secrets in source — webhook secrets in env + MongoDB. Untrusted GitHub content sanitized at render. Webhook signature verification mandatory. RBAC enforced server-side on every route. Toggle returns 404 to avoid feature-existence disclosure. |

**Post-Phase-1 re-check**: see end of plan; no violations introduced.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/
├── plan.md                  # This file
├── research.md              # Phase 0 — toggle, viz, webhook, sandbox-deploy decisions
├── data-model.md            # Phase 1 — entities, fields, relations, state machine
├── mongodb-migration.md     # Phase 1 — collections, indexes, rollback (Storage = MongoDB)
├── quickstart.md            # Phase 1 — how to enable + onboard a repo locally
├── contracts/               # Phase 1 — API + SSE + webhook schemas
│   ├── http-api.md
│   ├── sse-channels.md
│   └── github-webhook-events.md
├── checklists/
│   └── requirements.md      # (already exists from /speckit.specify)
└── tasks.md                 # Phase 2 — created by /speckit.tasks (NOT here)
```

### Source Code (repository root)

```text
ui/
├── src/
│   ├── app/
│   │   ├── (app)/
│   │   │   └── ship-loop/                       # NEW route group; gated by Config.shipLoopEnabled + user flag
│   │   │       ├── layout.tsx                   # Server-side gate: returns 404 if shipLoopEnabled=false
│   │   │       ├── page.tsx                     # Portfolio dashboard (US3)
│   │   │       ├── onboard/page.tsx             # Onboarding flow (US1)
│   │   │       └── repos/[owner]/[repo]/
│   │   │           ├── page.tsx                 # Per-repo Epic list
│   │   │           └── epics/[epicId]/page.tsx  # Per-Epic visualization (US2 + US4)
│   │   └── api/
│   │       └── ship-loop/                       # NEW; every route 404s when disabled
│   │           ├── repos/route.ts               # GET (list), POST (onboard)
│   │           ├── repos/[owner]/[repo]/route.ts# GET, DELETE (offboard)
│   │           ├── repos/[owner]/[repo]/epics/route.ts
│   │           ├── repos/[owner]/[repo]/epics/[epicId]/route.ts
│   │           ├── repos/[owner]/[repo]/epics/[epicId]/events/route.ts  # SSE
│   │           ├── actions/approve-pr/route.ts  # HITL: POST
│   │           ├── actions/request-changes/route.ts
│   │           ├── actions/retry-deploy/route.ts
│   │           ├── actions/pause-loop/route.ts
│   │           └── webhooks/github/route.ts     # POST; HMAC-verified
│   ├── components/
│   │   └── ship-loop/                           # NEW
│   │       ├── ShipLoopGuard.tsx                # Reads config + feature flag; renders disabled-state or 404
│   │       ├── ShipLoopHome.tsx                 # Portfolio dashboard
│   │       ├── OnboardRepoDialog.tsx
│   │       ├── EpicView.tsx                     # Hosts the active visualization mode
│   │       ├── visualizations/
│   │       │   ├── PipelineView.tsx             # MVP — mode A
│   │       │   ├── KanbanView.tsx               # MVP — mode B
│   │       │   ├── TimelineView.tsx             # MVP — mode C
│   │       │   ├── DependencyGraphView.tsx      # Post-MVP — mode D (uses @xyflow/react)
│   │       │   └── ShipLoopRadarView.tsx        # Post-MVP — mode E
│   │       ├── HitlActionBar.tsx                # Approve / Request changes / Retry deploy / Pause loop
│   │       ├── NeedsYouInbox.tsx
│   │       ├── StageBadge.tsx
│   │       └── WebhookHealthBanner.tsx
│   ├── hooks/
│   │   ├── use-ship-loop-feature.ts             # Combined gate: config.shipLoopEnabled && flag.shipLoop
│   │   ├── use-onboarded-repos.ts
│   │   ├── use-epic-ship-state.ts               # Derives stage from events; powers all viz modes
│   │   └── use-ship-loop-stream.ts              # SSE client for live updates
│   ├── store/
│   │   ├── feature-flag-store.ts                # MODIFY — add shipLoop flag
│   │   └── ship-loop-store.ts                   # NEW — selected viz mode, filters, current Epic
│   ├── lib/
│   │   ├── ship-loop/
│   │   │   ├── stage-resolver.ts                # Pure fn: events + labels → ship-loop stage
│   │   │   ├── github-client.ts                 # Octokit wrapper (server-only)
│   │   │   ├── webhook-verify.ts                # HMAC SHA-256 verification
│   │   │   └── mongo-collections.ts             # Typed wrappers around getCollection
│   │   └── config.ts                            # MODIFY — add shipLoopEnabled to Config
│   └── types/
│       └── ship-loop.ts                         # Shared TS types (mirrors data-model.md)
└── env.example                                   # MODIFY — document SHIP_LOOP_ENABLED + GITHUB_WEBHOOK_SECRET
```

**Structure Decision**: This is a UI-led feature. All code lives under `ui/` using the Next.js App Router patterns already established in the repo. The new `(app)/ship-loop/` route group, `components/ship-loop/`, `hooks/`, `store/`, and `lib/ship-loop/` directories follow the existing convention used by `dynamic-agents`, `knowledge-bases`, and `task-builder`. No backend Python service is added in MVP — webhook ingestion is handled by a Next.js API route, persisted to MongoDB, and pushed to clients via SSE.

## Database migrations

**Deliverable**: [`mongodb-migration.md`](./mongodb-migration.md) (created in Phase 1).

**Required or no-op**: **Required** — three new MongoDB collections (`ship_loop_repos`, `ship_loop_events`, `ship_loop_artifacts`) plus their indexes. No data backfill on first deploy (the feature starts empty). Rollback = drop the three collections; the rest of the app is unaffected because every read is guarded behind `Config.shipLoopEnabled`.

Full schema, index list (with query-pattern justification), and rollback steps are documented in `mongodb-migration.md`.

## Complexity Tracking

No constitution violations. The two-layer feature toggle (server kill switch + per-user opt-in) is **not** a violation of YAGNI/Worse-is-Better — it's the existing pattern in this codebase (`ragEnabled` + RAG-related per-user prefs, `dynamicAgentsEnabled` + group gating). We are reusing it, not inventing a third mechanism.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none) | — | — |

---

## Phase 0 — Research

See [`research.md`](./research.md). Topics resolved:

1. **Feature-toggle pattern for "entire feature behind a toggle"** — adopt the two-layer pattern already used by `ragEnabled` and `dynamicAgentsEnabled`. Server kill switch (`SHIP_LOOP_ENABLED` env → `Config.shipLoopEnabled`) + per-user `shipLoop` entry in `feature-flag-store`. API routes return **404** (not 403) when disabled, to match RAG/dynamic-agents precedent and avoid feature-existence disclosure.
2. **Visualization library choices** — React Flow (`@xyflow/react`) for the dependency graph mode only. All other modes use plain SVG + Tailwind/CSS Grid. Rejected: full d3.js (overkill), recharts/visx (don't model graph layouts), nivo (heavyweight).
3. **Webhook ingestion path** — Next.js API route (`/api/ship-loop/webhooks/github`) using `@octokit/webhooks` for HMAC SHA-256 signature verification. Rejected: a separate Python FastAPI service for MVP (adds ops surface for no MVP win).
4. **Live updates transport** — SSE (matches existing `sse-streaming-client.ts`). Rejected: WebSocket (no bidirectional need; server-pushed events are sufficient).
5. **Sandbox EKS deploy visualization** — read GitHub `deployment` + `deployment_status` events for environments matching the configured-at-onboard environment string (e.g., `sandbox-eks`). No direct EKS API calls in MVP. Rejected: Argo CD MCP integration (out-of-scope and requires separate auth).
6. **Idempotency / out-of-order webhook handling** — store every event with `(repo_id, github_event_id, delivered_at)` as a unique compound key; derive current stage from the event log on read, not on write. Re-delivery is harmless.
7. **Authorization model** — re-use existing `next-auth` session and the user's GitHub OAuth token (already required by other GitHub-touching features). Cache repo-level permission per user for 5 min.

## Phase 1 — Design & Contracts

Generated artifacts:

- **[`data-model.md`](./data-model.md)** — TypeScript-shaped entity definitions (Onboarded Repository, Epic, Sub-task, Pull Request, Comment/Review Event, Label, Webhook Event, Deploy Record, Stage Transition, HITL Action, Ship-loop Stage), with state-transition table for stages.
- **[`contracts/http-api.md`](./contracts/http-api.md)** — Every `/api/ship-loop/**` route, its method, request/response JSON shape, and the gating behavior (404 when disabled).
- **[`contracts/sse-channels.md`](./contracts/sse-channels.md)** — SSE event schema for the per-Epic stream and per-user "Needs you" stream.
- **[`contracts/github-webhook-events.md`](./contracts/github-webhook-events.md)** — Subset of GitHub webhook events consumed (`issues`, `issue_comment`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `push`, `check_run`, `check_suite`, `deployment`, `deployment_status`, `label`), the fields we read, and the rejection rules.
- **[`mongodb-migration.md`](./mongodb-migration.md)** — Collection schemas, compound indexes (with query justification), and rollback.
- **[`quickstart.md`](./quickstart.md)** — How to enable the toggle locally, set the GitHub webhook secret, onboard a repo, and verify a webhook end-to-end.

**Agent context update**: run `.specify/scripts/bash/update-agent-context.sh cursor-agent` after the plan command lands (handled below).

## Post-Phase-1 Constitution Re-check

Re-evaluated after generating Phase 1 artifacts: **no new violations**. The two-layer toggle is a reuse of an existing pattern, the new MongoDB collections are minimal and dropable, the API surface is small and consistent with current routes, and the security posture (HMAC verification, deny-by-default authz, sanitized rendering, 404-when-disabled) is fully aligned with Constitution §VII.
