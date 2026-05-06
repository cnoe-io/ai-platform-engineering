# Feature Specification: Agentic SDLC Ship Loop UI

**Feature Branch**: `2026-05-05-agentic-sdlc-ship-loop-ui`
**Created**: 2026-05-05
**Status**: Draft
**Input**: User description: "We are creating a radically new UI experience for agentic SDLC. A new tab where the user or team will onboard a repo. Agentic SDLC is where autonomous agents take an Epic and create sub tasks and labels, work on coding tasks, create PRs, wait for human-in-the-loop, once the PRs are merged they are deployed to sandbox EKS clusters. All of this needs to be visualized as explained in the blog 'Engineers Write the Rules. Agents Run the Ship Loop.' Show options for rich visualization of the agentic SDLC so users can keep up with tasks, epics, and PRs while agents do the work. Humans define the specs; agents task and code. We need to track where each task is. We will rely on GitHub webhook events (issues, PRs, comments) and agent-applied labels to power a live dashboard."

## Overview *(mandatory)*

The Agentic SDLC Ship Loop UI is a new top-level tab in the platform that lets a user or team onboard a GitHub repository and then **watch, steer, and approve** the agentic Software Development Life Cycle as autonomous agents take an Epic from intent to a sandbox deployment.

Humans own product intent and quality outcomes; agents do the doing. The UI's job is to make every step of that ship loop **visible at a glance, drillable on demand, and actionable in one click** when human-in-the-loop (HITL) is required.

The UI is event-driven: GitHub webhook events (issues, pull requests, comments, reviews, deployments) and agent-applied labels (e.g., `agent:planning`, `agent:coding`, `agent:awaiting-review`, `agent:deploy-sandbox`) are the source of truth for "where is each task right now?" The UI never owns workflow state; it reflects what the agents and GitHub say.

## Clarifications

### Session 2026-05-05

- Q: Should we adopt CopilotKit/CoAgents for the Ship Loop UI? → A: **Hybrid (Option C) using AG-UI** — keep the planned event-sourced visualizations and bespoke HITL action bar, **and** add a side panel that talks to a **preconfigured CAIPE Dynamic Agent** over the existing **AG-UI** protocol (the open agent-UI protocol the codebase already speaks via `@ag-ui/core`, `ui/src/lib/agui-sse-format.ts`, and `DynamicAgentChatPanel`). The panel lets the user "talk to the loop" (ask questions about an Epic, request a status summary, nudge the agent, draft an HITL comment) without replacing the visualizations or HITL chrome. CopilotKit itself is **not** added as a dependency — AG-UI is the substrate.
- Q: Authz model for HITL approvers? → A: **MVP uses GitHub permissions only** (no Ship-Loop-internal roles). Revisit a Ship-Loop "release approver" role as a follow-up feature only if a team explicitly requests it; do not pre-build for it.
- Q: Event-log retention? → A: **Deferred to planning.** The default of 90 days raw events + indefinite HITL audit + indefinite derived artifacts (per `mongodb-migration.md`) stands; operators can override per environment.
- Q: Webhook ingestion architecture? → A: **Option A with asynchronous DB writes.** A single shared Next.js receiver (`POST /api/ship-loop/webhooks/github`) handles every onboarded repo; it verifies the HMAC against the per-repo secret synchronously, enqueues the verified delivery into an **in-process async worker** (e.g., a bounded async task queue inside the Node process), and returns **`202 Accepted`** immediately. The worker then persists to `ship_loop_events`, projects derived state into `ship_loop_artifacts`, and publishes to the per-Epic and per-user SSE channels. No external queue/service is added; we keep the option of moving to Mongo change streams or a dedicated queue later without changing the receiver's public contract.
- Q: Observability minimums for MVP? → A: **Option B — structured logs + 4 core counters/gauges, no distributed tracing yet.** Use the existing structured-logging patterns. Expose four SLIs via the existing health surface: (1) webhook deliveries by outcome (accepted / rejected / deferred), (2) async worker queue depth, (3) projection latency p50/p95, (4) active SSE connections. OpenTelemetry tracing is deferred to a follow-up.
- Q: Should the UI show repo/team velocity? → A: **Yes — ship a velocity panel in MVP** alongside the portfolio dashboard, derived from the same event log (no separate metrics store). Default metrics: Epics merged per week (per repo + per team), median time-in-stage per stage, agent-vs-human authored PRs, and HITL queue age (median time a PR spends in `Review (HITL)`). Trend windows: 7-day, 30-day, 90-day. Drill-through from any velocity tile back into the underlying Epics/PRs.
- Q: Should we surface agent token usage? → A: **Yes — Option A: LLM/agent token spend per Epic** as the agentic equivalent of "story-point velocity." Data is read from existing CAIPE telemetry (Langfuse via `ui/src/lib/langfuse.ts` and/or Dynamic Agent run records); **no new metrics store**. Surfaced as (i) a chip on the Epic header (token count + tokens-per-merged-PR), (ii) a tile on the Velocity panel (total tokens + $-cost trend, scoped per repo/team, 7/30/90d). **Token counts visible to any user with repo read access; $-cost visible only to repo admins** to avoid per-author spend dynamics. Out of scope for MVP: per-developer leaderboards, hard budget enforcement, real-time overrun alerts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Onboard a repository to the Ship Loop (Priority: P1)

A platform engineer or team lead opens the new "Ship Loop" tab, connects a GitHub repository, picks an environment (e.g., `sandbox-eks`), and confirms which labels and webhook events should drive the dashboard. After onboarding, the repo appears as a tile/card on the Ship Loop home with its current health and active Epics.

**Why this priority**: Nothing else in the feature has value without an onboarded repo. This is the entry point and the smallest possible end-to-end slice that proves the concept.

**Independent Test**: A user can onboard a repo, see a confirmation that webhooks were registered (or that they need to register them), and immediately see the repo card on the Ship Loop home. No agents need to have run yet — an empty loop is still a successful onboarding.

**Acceptance Scenarios**:

1. **Given** the user has GitHub access to a repository, **When** they click "Onboard Repo" and select that repository and a target sandbox environment, **Then** the system records the onboarding, ensures the required webhook subscription exists, and adds the repo to the Ship Loop home within 5 seconds.
2. **Given** a repo is already onboarded, **When** the user re-opens the Ship Loop tab, **Then** the repo appears with up-to-date counts of open Epics, in-flight tasks, PRs awaiting review, and deploys in the last 24 hours.
3. **Given** webhook delivery fails or is misconfigured, **When** the user opens the repo's Ship Loop view, **Then** the UI clearly surfaces a "Webhook not healthy" banner with a one-click "Reconnect" action.

---

### User Story 2 - Visualize the Ship Loop end-to-end for a single Epic (Priority: P1)

A user opens an Epic from the onboarded repo. They see the Epic move through the canonical ship-loop stages — **Specify → Plan → Tasks → Implement → Review (HITL) → Merge → Deploy → Observe** — with every sub-task, PR, comment thread, and deployment shown in context. They can tell within seconds: "Where is this Epic right now? Who/what is blocked? What needs me?"

**Why this priority**: This is the core visualization. The product's "wow" moment is being able to see the agentic ship loop running end-to-end on a real Epic without context-switching to GitHub, Jira, or kubectl.

**Independent Test**: With one onboarded repo and one Epic that has at least one sub-task, one PR, and one deploy event, a user can open the Epic view and correctly identify (a) the current stage, (b) which artifacts (issues/PRs) belong to the Epic, and (c) any HITL action required of them, all without clicking out of the page.

**Acceptance Scenarios**:

1. **Given** an Epic with sub-tasks created by an agent, **When** the user opens the Epic, **Then** every sub-task is shown grouped under the Epic with its current ship-loop stage derived from agent labels and GitHub state.
2. **Given** an agent has just opened a PR for a sub-task, **When** the webhook is received, **Then** the Epic view updates within 10 seconds (live, no manual refresh) to show the new PR linked to the sub-task with stage `Review (HITL)`.
3. **Given** a PR awaits human review, **When** the user views the Epic, **Then** the sub-task is visually marked as "Needs you" and the user can approve, request changes, or comment from inside the Ship Loop UI.
4. **Given** a PR is merged and a sandbox deploy starts, **When** deployment events arrive, **Then** the sub-task moves to `Deploy` and shows live deploy status (in-progress / success / failed) with a link to the deployment record.

---

### User Story 3 - Live team/portfolio dashboard across all onboarded repos (Priority: P2)

A team lead opens the Ship Loop home and sees a live, auto-refreshing dashboard across every onboarded repo: how many Epics are in each stage, how many PRs are waiting on humans, how many sandbox deploys happened today, and which Epics are stuck. They can filter by repo, owner, label, or stage.

**Why this priority**: After per-Epic visualization works (P1), portfolio-level visibility is the next-most-valuable view, especially for managers and SREs running multiple agentic streams in parallel.

**Independent Test**: With at least two onboarded repos and Epics in different stages, a user opens the dashboard and can correctly read counts per stage, filter to a single repo, and click into any tile to drill into the underlying Epic or PR list.

**Acceptance Scenarios**:

1. **Given** multiple repos are onboarded, **When** the user opens the Ship Loop home, **Then** they see counts of Epics by stage, PRs awaiting review, and deploys in the last 24h, updating live as webhook events arrive.
2. **Given** an Epic has been stuck in `Review (HITL)` for longer than a configured threshold, **When** the user opens the dashboard, **Then** that Epic is flagged as "Stalled" with the duration and the assigned reviewer surfaced.
3. **Given** the user applies a filter (e.g., repo + label), **When** the filter is applied, **Then** all dashboard widgets update consistently and the filter persists across page reloads for that user.

---

### User Story 4 - Visualization options the user can choose between (Priority: P2)

A user can switch the active Epic view between several visualization modes that present the same underlying state in radically different ways, suited to different roles and moments. The user picks a default, and can switch on the fly.

**Why this priority**: The blog explicitly frames the Ship Loop as the new mental model. Different viewers (engineer fixing a bug vs. EM planning a sprint vs. SRE watching a deploy) need different visual representations of the same data. A single fixed visualization will under-serve at least one persona.

**Independent Test**: With one Epic that has at least three sub-tasks, two PRs, and one deploy, the user can switch between visualization modes and confirm that all artifacts and stages are represented in each mode, with no loss of fidelity.

**Acceptance Scenarios**:

1. **Given** an Epic is open, **When** the user picks visualization mode "Pipeline / Ship-loop diagram", **Then** they see a horizontal pipeline of stages (Specify → Plan → Tasks → Implement → Review → Merge → Deploy → Observe) with each artifact rendered as a token sitting in its current stage.
2. **Given** the same Epic, **When** the user picks "Kanban swimlanes", **Then** stages render as columns and sub-tasks/PRs as cards that drag-flow between columns as agent events arrive.
3. **Given** the same Epic, **When** the user picks "Timeline", **Then** they see a horizontal time axis with each agent action, label change, PR open, review, merge, and deploy plotted in chronological order.
4. **Given** the same Epic, **When** the user picks "Dependency graph", **Then** they see the Epic as a root node with sub-tasks, PRs, and deploys as connected nodes, color-coded by stage and HITL status.
5. **Given** the same Epic, **When** the user picks "Ship-loop radar", **Then** they see the four-quadrant ship-loop cycle (Specify / Execute / Verify / Deliver+Observe) with active artifacts orbiting in the quadrant that matches their current stage, giving an at-a-glance "where is the loop right now?" view.

> Visualization options summary (the user picks any one as default; all are kept in sync because they read the same event-sourced state):
>
> | Option | What the user sees | When it's most useful |
> |--------|-------------------|------------------------|
> | A. Pipeline / Ship-loop diagram | Horizontal stages with artifact tokens | "Show me the loop." Default for individual contributors. |
> | B. Kanban swimlanes | Stage columns with task/PR cards | "What's in flight, what's blocked?" Default for tech leads. |
> | C. Timeline | Time-ordered stream of agent + GitHub events | "What happened, when, in what order?" Audits, post-mortems. |
> | D. Dependency graph | Epic → tasks → PRs → deploys as a graph | "How are things connected? Where is the blast radius?" |
> | E. Ship-loop radar | Four-quadrant orbit (Specify/Execute/Verify/Deliver) | At-a-glance "where is the loop right now?" Exec/leadership view. |
> | F. Heatmap (across repos) | Repo × stage grid colored by activity | Portfolio view across many repos. |

---

### User Story 5 - Human-in-the-loop actions inline (Priority: P2)

When the user is the requested reviewer/approver, they can act on the Epic from inside the Ship Loop UI without bouncing to GitHub: approve a PR, request changes, comment, re-run a failing check, retry a failed deploy, or kill an agent loop that has gone off-track.

In addition to the bespoke HITL action bar, a per-Epic **"Talk to the loop" side panel** is available that streams from a preconfigured CAIPE Dynamic Agent over the AG-UI protocol. The user can ask questions about the Epic ("Why is this stalled?", "Summarize the last 3 PRs"), request a stage transition explanation, or have the agent draft an HITL comment that the user reviews and submits. The Dynamic Agent is given read-only context for the active Epic (artifacts, recent events, current stage) and is **not** authorized to take destructive actions on the user's behalf — every action that mutates GitHub or the loop still goes through the explicit HITL action bar with a human click.

**Why this priority**: The blog's central claim is that humans own intent and quality; agents do the doing. If HITL still requires context-switching to GitHub for every approval, the UI fails the persona it was built for.

**Independent Test**: A user can complete an end-to-end HITL approval (approve a PR, see the merge happen, see the sandbox deploy kick off) entirely from the Ship Loop UI on a single Epic. Separately, a user can open the "Talk to the loop" panel, ask "what's blocking this Epic?", and receive a streamed answer that cites the events the assistant used.

**Acceptance Scenarios**:

1. **Given** a PR awaits review, **When** the user clicks "Approve" in the Ship Loop UI, **Then** the approval is recorded on the underlying GitHub PR and the Epic view reflects the new state within 10 seconds.
2. **Given** a sandbox deploy fails, **When** the user clicks "Retry deploy", **Then** the deploy is retried and the UI reflects the new attempt's status live.
3. **Given** an agent appears stuck (no events for a configurable duration in `Implement`), **When** the user clicks "Pause loop" or "Reassign", **Then** an agent-control event is emitted and the Epic view shows the new state.
4. **Given** an Epic is open, **When** the user opens the "Talk to the loop" side panel and asks a question, **Then** the preconfigured Dynamic Agent streams a grounded answer (citing the Epic's artifacts/events) over AG-UI within the same SLO as other agent chats in the app.
5. **Given** the user asks the assistant to "approve the PR", **When** the assistant responds, **Then** it does **not** approve directly — it offers a draft comment and instructs the user to confirm via the HITL action bar; any direct mutation attempt MUST be rejected by the server.

---

### User Story 6 - Repo and team velocity (Priority: P2)

A team lead opens the Ship Loop home and clicks **Velocity** on the portfolio dashboard. They see a panel with five trend metrics — Epics merged per week, median time-in-stage per stage, agent-vs-human authored PR mix, HITL queue age, and **agent token spend** — for the last 7, 30, or 90 days. They can scope by repo or team (where "team" is derived from repo membership) and click any tile to drill into the Epics/PRs that produced the number. On the per-Epic view, a token-spend chip in the header tells them how many tokens the agent burned producing this Epic so far, and the tokens-per-merged-PR ratio.

**Why this priority**: The blog frames velocity differently for the agentic era — convergence in fewer loops, not lines of code, with token spend as the new accountability unit ("the cost unit shifts from developer-hours to compute-hours plus human-review-hours"). A team lead's first questions after onboarding several repos are "are we getting faster?" and "is our agent budget being used efficiently?" Without first-class velocity + token-spend surfaces, the UI shows current state but not trend or cost, and the value story breaks for managers and EMs.

**Independent Test**: With at least one repo onboarded for ≥7 days and ≥3 merged Epics, a user can open the Velocity panel and (a) read all five trend metrics for that repo over the last 7/30/90 days, (b) switch the scope between "this repo" and "all my repos", (c) drill from any tile to a list of the underlying Epics/PRs, and (d) confirm that $-cost is visible to repo admins only while raw token counts are visible to all readers.

**Acceptance Scenarios**:

1. **Given** a repo with merged Epics over the past 30 days, **When** the user opens the Velocity panel, **Then** they see "Epics merged per week" rendered as a 30-day trend with the count, the WoW delta, and a sparkline.
2. **Given** Epics that passed through `Review (HITL)`, **When** the user views the Velocity panel, **Then** the median HITL queue age is shown for the selected window, with the slowest 3 PRs surfaced as a callout.
3. **Given** a mix of agent and human-authored PRs, **When** the user views the Velocity panel, **Then** the agent-vs-human ratio is shown for the selected window, with absolute counts on hover.
4. **Given** the user clicks a velocity tile, **When** the drill-through opens, **Then** the underlying Epics/PRs that contributed to that number are listed with deep-links into the Ship Loop and GitHub.
5. **Given** an Epic has accumulated agent token usage from CAIPE telemetry, **When** the user opens the Epic, **Then** a token-spend chip in the header shows total tokens and tokens-per-merged-PR; the same Epic appears on the Velocity panel's token-spend tile contributing to the repo total.
6. **Given** a user **without** repo-admin permission opens the Velocity panel, **When** they view the token-spend tile, **Then** they see token counts but $-cost is hidden / masked; admins see both.
7. **Given** CAIPE telemetry is unavailable for some events, **When** the token-spend surface renders, **Then** affected windows are clearly marked "incomplete" rather than showing a misleadingly low number.

---

### User Story 7 - Drill into agent thinking and harness signals (Priority: P3)

Power users can open a sub-task and see the agent's recent steps, the harness checks that ran (lint, unit tests, security scan, architectural rules), and which checks gated progress. This makes the harness visible the way the blog argues it must be: "every failed test is a feedback signal that makes the next agent run better."

**Why this priority**: Important for trust and debugging, but the dashboard delivers value even without this depth. P3 because P1/P2 are required to make P3 useful.

**Independent Test**: For one sub-task with at least one harness gate (e.g., a CI check) and at least one agent-recorded action, a user can open a "details" panel and read the chronological list of agent steps and check outcomes.

**Acceptance Scenarios**:

1. **Given** a sub-task with CI checks, **When** the user opens its detail view, **Then** they see each check, its status, and a link to its log.
2. **Given** the agent has emitted progress notes (via comments, commit messages, or webhook payload metadata), **When** the user opens the detail view, **Then** those notes appear in chronological order alongside GitHub-native events.

---

### Edge Cases

- A repository has no Epics yet — the Ship Loop view must show an empty-state with clear guidance ("Create or import an Epic; agents will pick it up").
- Webhook delivery is delayed or out-of-order — the UI must reconstruct the correct latest state and not flap between stages on reordered events.
- A label is applied by a human, not an agent — the UI must still respect it (humans always override).
- Two agents act on the same Epic at the same time — the UI must show concurrent activity without making it look like a conflict unless GitHub itself flags one.
- A PR is merged outside the agent flow (e.g., a human merges directly) — the Epic must still progress correctly to `Deploy` if a deploy is triggered.
- Sandbox EKS deploy is blocked by a policy gate — the UI must show the gate decision and the policy rule that fired, not just "failed".
- Repo is offboarded or webhook is removed — historical Epic data should remain readable in a "read-only" mode; live updates stop.
- Many Epics in flight (≥100) — visualizations must remain readable; pagination, virtualization, and grouping are required.
- The same artifact (issue/PR) is referenced by two Epics — the UI must show both linkages without duplicating the artifact.
- An agent applies a label the UI does not recognize — the UI must show the artifact in a safe default stage (e.g., last known stage) and surface the unknown label rather than silently dropping it.

## Requirements *(mandatory)*

### Functional Requirements

#### Onboarding & configuration

- **FR-001**: System MUST provide a new top-level "Ship Loop" tab in the UI, accessible to authenticated users with the appropriate role.
- **FR-002**: Users MUST be able to onboard a GitHub repository to the Ship Loop by selecting it from repos they already have access to and confirming a target sandbox deployment environment.
- **FR-003**: System MUST verify (or initiate creation of) the required GitHub webhook subscription on onboarded repos and surface webhook health status in the UI.
- **FR-004**: Users MUST be able to offboard a repo; the system MUST stop live updates for that repo while preserving historical data in a read-only state.
- **FR-005**: System MUST allow a per-repo configuration of the canonical ship-loop stages and the agent-label-to-stage mapping (with documented defaults).

#### Event ingestion & state derivation

- **FR-006**: System MUST consume GitHub webhook events for at minimum: `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `push`, `check_run`/`check_suite`, `deployment`, `deployment_status`, and `label`.
- **FR-007**: System MUST treat agent-applied labels as the primary signal of agentic stage and MUST resolve final state by combining labels with native GitHub state (e.g., PR merged, deploy succeeded).
- **FR-008**: System MUST handle out-of-order, duplicate, and delayed webhook deliveries without producing flapping or incorrect stage transitions. Idempotency MUST be enforced by `(repo_id, github_delivery_id)`; current stage MUST be derived from the event log, not mutated in place.
- **FR-009**: System MUST persist a chronological event log per Epic and per artifact sufficient to reconstruct the timeline visualization and to support audit/post-mortem.
- **FR-010**: System MUST detect and clearly surface webhook delivery failures or gaps and offer a one-click reconnect / backfill action.
- **FR-010a**: System MUST expose a single shared webhook receiver endpoint that serves every onboarded repository; the receiver MUST verify the HMAC signature synchronously against the per-repo secret, then **persist asynchronously** — the receiver returns `202 Accepted` after enqueueing the verified delivery to an in-process async worker that handles DB writes, derived-state projection, and SSE fanout. The receiver's synchronous response time MUST be <100 ms p95 under pilot load. Rejected (unsigned/mismatched/malformed) deliveries MUST NOT be enqueued.
- **FR-010b**: The async worker queue MUST be bounded with a deterministic backpressure policy: when full, additional verified deliveries are persisted directly to `ship_loop_events` with a flag indicating projection deferred, and the projector retries them on the next tick. No verified delivery may be silently dropped.

#### Visualization

- **FR-011**: System MUST provide a per-Epic view that shows the Epic, its sub-tasks, its PRs, its deploys, and its current ship-loop stage, all on one screen.
- **FR-012**: System MUST offer at least the following visualization modes for the Epic view, switchable per user without losing state: (A) Pipeline / Ship-loop diagram, (B) Kanban swimlanes, (C) Timeline, (D) Dependency graph, (E) Ship-loop radar.
- **FR-013**: System MUST provide a Ship Loop home / portfolio dashboard with cross-repo counts by stage, "needs human" queue, and stalled-Epic highlighting.
- **FR-014**: System MUST update visualizations live as new events arrive, with no manual refresh required, within 10 seconds of webhook receipt under normal load.
- **FR-015**: System MUST allow users to filter and group Epics by repo, owner, label, stage, and "needs me" status, with filters persisted per user.
- **FR-016**: System MUST clearly distinguish agent-driven actions from human-driven actions in every visualization (e.g., distinct iconography or color treatment).

#### Velocity

- **FR-V01**: System MUST provide a Velocity panel on the Ship Loop home, scopable by repo and by team (where "team" is derived from repo membership / GitHub team metadata).
- **FR-V02**: System MUST compute and display the following velocity metrics, derived from the event log and existing CAIPE telemetry (no new metrics store): (a) Epics merged per week, (b) median time-in-stage per ship-loop stage, (c) agent-vs-human authored PR count and ratio, (d) median HITL queue age (time PRs spend in `Review (HITL)` before approve/changes-requested), and (e) **agent token spend** (total tokens and approximate $-cost) per Epic, per repo, and per team.
- **FR-V03**: System MUST support trend windows of 7 days, 30 days, and 90 days, with week-over-week / period-over-period deltas shown for each metric.
- **FR-V04**: System MUST allow drill-through from any velocity tile back to the underlying Epics/PRs (and, for token spend, the underlying agent run records or Langfuse traces where available) that contributed to that number, with deep-links into the Ship Loop view and the canonical GitHub URLs.
- **FR-V05**: System MUST clearly indicate when the configured trend window exceeds the raw event log retention (default 90 days per `mongodb-migration.md`); metrics that depend on data older than retention MUST be either marked "incomplete" or computed only from the surviving derived `ship_loop_artifacts` summary, never silently truncated. The same "incomplete" marking MUST be applied when CAIPE telemetry is unavailable for the requested window for token-spend metrics.
- **FR-V06**: Velocity computations MUST honor the same authorization model as the rest of the feature — a user only sees velocity for repos/teams they have GitHub read access to.
- **FR-V07**: Token-spend data MUST be sourced from existing CAIPE telemetry (Langfuse traces and/or Dynamic Agent run records correlated to the Epic via the agent's working metadata); the system MUST NOT introduce a new long-term metrics store for tokens.
- **FR-V08**: Token-spend display MUST distinguish two access tiers: (a) **token counts** are visible to any user with repo read access; (b) **$-cost** is visible only to users with repo-admin / billing permission (resolved via GitHub repo permission). Users without admin permission MUST see token counts but a masked / hidden $-cost.
- **FR-V09**: Per-Epic views MUST display a token-spend chip in the Epic header showing the running total tokens and the tokens-per-merged-PR ratio for that Epic, sourced from FR-V07.
- **FR-V10**: System MUST NOT, in MVP, implement (a) per-developer / per-author token leaderboards, (b) hard budget enforcement that blocks agent runs when a threshold is hit, or (c) real-time alerting on token-spend overrun. These are explicit out-of-scope items.

#### Human-in-the-loop actions

- **FR-017**: Users MUST be able to approve a PR, request changes, and comment on a PR directly from the Ship Loop UI for any Epic they have permission to act on.
- **FR-018**: Users MUST be able to retry a failed sandbox deploy and pause/resume an agent loop on an Epic, where the underlying systems support those actions.
- **FR-019**: System MUST record the human actor for every HITL action and surface that actor in the timeline/audit view.
- **FR-020**: System MUST surface a per-user "Needs you" inbox listing every artifact across all onboarded repos that requires that user's review/approval.

#### Drill-down & traceability

- **FR-021**: For any sub-task or PR, the system MUST show the underlying GitHub events, harness/CI checks, and any agent-emitted progress notes in chronological order.
- **FR-022**: For any deploy event, the system MUST show the target environment (e.g., `sandbox-eks`), the commit/PR that triggered it, and the live status until terminal (success/failed/cancelled).
- **FR-023**: System MUST link every UI artifact back to its canonical GitHub URL.

#### Security, access, and audit

- **FR-024**: System MUST enforce that a user can only see Ship Loop data for repos they have at least read access to in the source GitHub organization. **GitHub permissions are the sole source of truth for authorization in MVP**: read-access for visibility, GitHub review/triage permission for PR approvals, and GitHub write permission for retry-deploy and pause/resume-loop actions. The system MUST NOT define internal Ship-Loop-only reviewer or approver roles.
- **FR-025**: System MUST authenticate webhook deliveries and reject unauthenticated or improperly signed webhook payloads.
- **FR-026**: System MUST record an immutable audit trail of every HITL action (approve, request-changes, retry, pause) including actor, timestamp, target artifact, and outcome.
- **FR-027**: System MUST never expose secrets (tokens, keys) referenced in webhook payloads or commit content within the UI; sensitive fields MUST be redacted at display.
- **FR-028**: System MUST treat all incoming webhook content as untrusted input for rendering purposes and MUST not execute or richly render unsanitized content (no script execution, attribute-encoded output, no `javascript:` URLs).

#### Reliability & UX baseline

- **FR-029**: System MUST gracefully degrade when live updates are unavailable: data is read-only, and the UI clearly indicates "live updates paused" rather than appearing broken.
- **FR-030**: System MUST provide an empty/onboarding state for the Ship Loop tab, the Ship Loop home, the per-repo view, and the per-Epic view with clear next-step guidance.

#### "Talk to the loop" assistant (AG-UI side panel)

- **FR-031**: System MUST provide a per-Epic "Talk to the loop" side panel that streams from a preconfigured CAIPE Dynamic Agent over the existing AG-UI protocol; the panel MUST share session/auth state with the rest of the app and never introduce a separate identity.
- **FR-032**: System MUST scope the assistant's read context to the currently open Epic (its artifacts, recent events, derived stage, webhook health) plus public repo metadata; it MUST NOT receive raw webhook payload secrets, other repos' data, or other users' HITL data.
- **FR-033**: The assistant MUST be **read-only with respect to GitHub and the loop**: it MAY draft comments, summaries, and suggested HITL actions, but every mutation (PR approval, request-changes, comment submission, retry deploy, pause/resume loop) MUST flow through the explicit HITL action bar with a human click. The server MUST reject any tool/action call from the assistant that attempts to mutate state directly.
- **FR-034**: The assistant's responses MUST be sanitized before render using the same allow-list applied to GitHub-sourced content (no raw HTML execution, no `javascript:` URLs, attribute-encoded output).
- **FR-035**: The "Talk to the loop" panel MUST be independently disable-able via a sub-toggle of the Ship Loop feature, so operators can disable just the assistant without disabling the visualizations or HITL chrome.

### Key Entities *(include if feature involves data)*

- **Onboarded Repository**: A GitHub repository the team has connected to the Ship Loop; carries webhook health, default sandbox environment, label-to-stage mapping, and onboarding actor/timestamp.
- **Epic**: The unit of human-defined intent (typically a GitHub issue with an `epic` label or equivalent). Has a current ship-loop stage, owner, target environment, and a set of sub-tasks.
- **Sub-task**: A child unit of work created by the agent (typically a GitHub issue) under an Epic. Has its own stage, assignee (human or agent), labels, and linked PR(s).
- **Pull Request**: A GitHub PR opened (typically by the agent) that implements one or more sub-tasks. Carries review status, CI/harness checks, and merge state.
- **Comment / Review Event**: A human or agent comment / review on an issue or PR; contributes to the timeline and may transition stage.
- **Label**: An agent-applied or human-applied label that indicates ship-loop stage, blockers, HITL needs, or environment targeting.
- **Webhook Event**: A raw record of a GitHub event delivered to the system; the source of truth from which all derived state is reconstructed.
- **Deploy Record**: A deployment event (typically to `sandbox-eks`) tied to a merged PR and an Epic; carries environment, status, start/end time, and triggering commit/PR.
- **Stage Transition**: A derived event marking when an artifact moved from one ship-loop stage to another, with reason (label change, PR merged, deploy succeeded, etc.).
- **HITL Action**: A human action taken from inside the Ship Loop UI (approve, request-changes, retry deploy, pause loop) with actor, target, timestamp, and outcome.
- **Ship-loop Stage**: An enumerated stage of the ship loop; default set: `Specify`, `Plan`, `Tasks`, `Implement`, `Review (HITL)`, `Merge`, `Deploy`, `Observe`. Per-repo overrides allowed.
- **Ship Loop Assistant**: A preconfigured CAIPE Dynamic Agent the "Talk to the loop" panel speaks to over the AG-UI protocol. Read-only with respect to GitHub and the loop; scoped to the active Epic's context. Configured at the platform level (which Dynamic Agent id, which model) and surfaced per-user via the Ship Loop assistant sub-toggle.
- **Velocity Metric**: A derived, time-windowed measurement computed from the event log and existing CAIPE telemetry. Members: `epics_merged_per_week`, `median_time_in_stage[stage]`, `agent_vs_human_pr_ratio`, `median_hitl_queue_age`, `agent_token_spend` (total tokens + approximate $-cost). Each metric carries the trend window (7/30/90 d), the scope (Epic / repo / team), the value, the period-over-period delta, a `completeness` flag (`complete` | `partial`) indicating whether all source data was available, and a link payload identifying the contributing artifacts and (where applicable) agent run / trace ids for drill-through.
- **Agent Run Record**: A single agent invocation correlated to an Epic via working metadata (e.g., the Epic id placed in the agent prompt, or the PR-level link). Carries token counts (`prompt_tokens`, `completion_tokens`, `total_tokens`), model id, latency, and Langfuse trace id when available. Sourced from existing CAIPE telemetry; not stored anew in the Ship Loop collections.
- **Team Scope**: A grouping unit for velocity metrics derived from GitHub team membership / repo collaborator data; not a stored Ship-Loop concept (we do not mirror team membership into MongoDB).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can onboard a new repository and see it on the Ship Loop home in under 60 seconds end-to-end (excluding GitHub-side webhook propagation outside our control).
- **SC-002**: After a webhook event is received by the system, the corresponding Epic/sub-task/PR visualization updates for any user currently viewing it within 10 seconds at the 95th percentile under normal load.
- **SC-003**: A user with an active Epic can identify "where is this Epic right now?" and "what does it need from me?" in under 5 seconds of opening the Epic view, validated by usability testing with at least 5 representative users.
- **SC-004**: 100% of HITL actions taken in the UI (approve, request-changes, retry, pause) are reflected in the source-of-truth GitHub state and audit log; mismatches must be 0.
- **SC-005**: 90% of internal pilot users can correctly answer "which Epics in my portfolio are stalled and why?" using only the Ship Loop home, without opening GitHub.
- **SC-006**: At least 3 of the 5 specified visualization modes are shipped in the initial release; users can switch modes without page reload.
- **SC-007**: Webhook delivery failures or gaps are detected and surfaced to the user within 2 minutes of the failure window opening.
- **SC-008**: Mean time from "agent opens PR" to "human reviewer notified inside the UI" decreases by at least 50% versus the baseline of polling GitHub manually, measured during pilot.
- **SC-009**: After 60 days of pilot use, at least 70% of pilot users report (via survey) that the Ship Loop UI is their primary interface for tracking agentic work, versus GitHub directly.
- **SC-010**: Zero security findings related to rendering untrusted webhook content (XSS, open redirect, secret disclosure) in penetration testing of the Ship Loop tab prior to GA.
- **SC-011**: After 30 days of pilot use, at least 80% of pilot team leads (surveyed) report that the Velocity panel — including the agent token-spend tile and per-Epic token chip — gives them an accurate-enough sense of repo/team trend and agent budget that they would use it for a weekly or sprint check-in instead of bespoke spreadsheets.
- **SC-012**: $-cost is visible **only** to users with repo-admin / billing permission, verified by audit log review across all pilot users at the 30-day mark; zero non-admin users may have seen $-cost.

## Assumptions *(non-mandatory)*

- The platform already has GitHub integration sufficient to register webhooks and authenticate users against the same GitHub org/account they want to onboard.
- A canonical default set of agent labels exists (or will be defined by the harness team) and is consistent enough across onboarded repos to drive a default label-to-stage mapping; per-repo overrides handle drift.
- "Sandbox EKS" is a representative target environment; the design should not bake in EKS-specific assumptions at the user-experience level — the UI shows whatever environment was configured at onboarding.
- Agents emit progress signals primarily through (a) GitHub state changes, (b) labels, (c) issue/PR comments, and (d) deployment events. Out-of-band agent telemetry (separate streams) is a P3 enrichment and not required for the MVP.
- "Live" updates are best-effort within the 10-second SLO. Strict ordering across distributed webhook deliveries is achieved by reconstructing state from the event log, not by relying on arrival order.
- The "Talk to the loop" assistant (FR-031..035) reuses the existing CAIPE Dynamic Agents subsystem and the AG-UI protocol already implemented in the codebase (`@ag-ui/core`, `ui/src/lib/agui-sse-format.ts`, `DynamicAgentChatPanel`). No third-party agent-UI framework (e.g., CopilotKit) is added. Which Dynamic Agent serves as the "Ship Loop Assistant" is platform configuration, not part of this feature's surface.
- Token-spend metrics (FR-V07..V09) read from the existing CAIPE telemetry pipeline (Langfuse via `ui/src/lib/langfuse.ts` and/or Dynamic Agent run records). The correlation key from agent runs to Epics is the Epic id (or repo/PR id) carried in the agent's working metadata; if a run is not correlated, it does not contribute to per-Epic totals (it still appears in the repo total when repo metadata is available). $-cost is computed from token counts × model price (price table sourced from existing CAIPE config); no new pricing service is introduced.

## Out of Scope

- Authoring or editing the agent harness, skills, or constraints from inside this UI (covered by the existing harness/skills tooling).
- Building or replacing GitHub's PR diff/review experience — the UI offers HITL actions and deep-links into GitHub for full diff review.
- Production deployments — only sandbox deploys are visualized in this feature; production deploy gating is out of scope.
- Multi-VCS support (GitLab, Bitbucket) — GitHub-only for the initial release.
- Cost/budget visualization for agent compute spend — referenced in the blog as future work, but out of scope here.
- Ship-Loop-internal reviewer/approver roles (e.g., "release approver" stored in MongoDB). MVP relies entirely on GitHub permissions; revisit as a follow-up feature only if requested.
- Per-developer / per-author token-spend leaderboards.
- Hard budget enforcement that blocks agent runs when a token or $-cost threshold is exceeded.
- Real-time alerting on token-spend overruns. (The Velocity panel shows trends; alerting is a separate platform feature.)
