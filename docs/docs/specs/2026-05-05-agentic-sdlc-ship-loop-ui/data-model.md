# Data Model — Agentic SDLC Ship Loop UI

This document defines the entities, fields, relationships, and state transitions for the Ship Loop feature. Field names use `snake_case` to match existing MongoDB collections in `ui/src/lib/mongodb.ts`.

## Entities

### `OnboardedRepo` → MongoDB collection `ship_loop_repos`

A GitHub repository connected to the Ship Loop.

| Field | Type | Notes |
|-------|------|-------|
| `_id` | `ObjectId` | Mongo primary key |
| `repo_id` | `string` | GitHub numeric repo id, stringified — stable across renames |
| `owner` | `string` | GitHub login of the owner (org or user) |
| `name` | `string` | Repo name (current; updated if renamed) |
| `full_name` | `string` | `owner/name`; convenience |
| `default_branch` | `string` | e.g., `main` |
| `sandbox_environment` | `string` | The deploy environment string the UI watches (e.g. `sandbox-eks`) |
| `webhook_id` | `number \| null` | GitHub webhook id; null until verified |
| `webhook_secret_hash` | `string` | SHA-256 hash of the webhook secret (the secret itself stored in the env-managed secret store, **never** in this collection) |
| `webhook_status` | `"healthy" \| "degraded" \| "missing" \| "unknown"` | Last observed |
| `webhook_last_event_at` | `Date \| null` | Last event delivery time |
| `last_reconciled_at` | `Date \| null` | Last GitHub issues/PRs reconciliation pull |
| `label_to_stage_overrides` | `Record<string, ShipLoopStage>` | Per-repo overrides on top of defaults |
| `onboarded_by_user_id` | `string` | The user who onboarded |
| `onboarded_at` | `Date` | |
| `offboarded_at` | `Date \| null` | When set, repo is read-only |
| `created_at` | `Date` | |
| `updated_at` | `Date` | |

**Indexes**: see `mongodb-migration.md`.

---

### `ShipLoopEvent` → MongoDB collection `ship_loop_events`

The append-only event log. One row per inbound webhook delivery (after HMAC verification) plus one row per HITL action taken inside the UI.

| Field | Type | Notes |
|-------|------|-------|
| `_id` | `ObjectId` | |
| `repo_id` | `string` | FK → `OnboardedRepo.repo_id` |
| `source` | `"github" \| "ui"` | `github` for webhook deliveries, `ui` for HITL actions |
| `github_delivery_id` | `string \| null` | Required when `source="github"`; from `X-GitHub-Delivery` header. Used for idempotency. |
| `github_event_type` | `string \| null` | e.g., `pull_request`, `issue_comment`, `deployment_status` |
| `github_action` | `string \| null` | e.g., `opened`, `closed`, `labeled` |
| `artifact_kind` | `"epic" \| "subtask" \| "pull_request" \| "deploy" \| "comment" \| "review" \| "label" \| "unknown"` | Derived by the projector |
| `artifact_id` | `string` | GitHub node id or PR/issue/deploy numeric id, stringified |
| `epic_id` | `string \| null` | Linked Epic if known; backfilled when the link becomes resolvable |
| `actor_kind` | `"agent" \| "human" \| "system"` | Derived from labels, app id, and user properties (see resolver) |
| `actor_login` | `string \| null` | GitHub login, or user id for `source="ui"` |
| `payload` | `Record<string, unknown>` | Raw verified webhook payload (or HITL action payload). Stored verbatim for replay/audit. |
| `delivered_at` | `Date` | When we received it (server time) |
| `occurred_at` | `Date` | The event's own timestamp from the payload (`created_at` etc.) |
| `projection_status` | `"projected" \| "deferred" \| "failed"` | Default `"projected"` once the async worker has updated `ship_loop_artifacts`. Set to `"deferred"` when the receiver had to skip the in-process queue (overflow) and persist directly; the projector retries deferred rows on the next tick. `"failed"` after exhausted retries; surfaced in operator dashboards. |
| `projection_attempts` | `number` | Increment each time the projector touches the row; helps detect poison events |

**Idempotency**: unique compound index on `(repo_id, github_delivery_id)` for `source="github"` rows; `(repo_id, source, _id)` for UI rows.

---

### `ShipLoopArtifact` → MongoDB collection `ship_loop_artifacts`

Derived, current-state row per Epic / sub-task / PR / deploy. Read by the UI; recomputed on every event insert.

| Field | Type | Notes |
|-------|------|-------|
| `_id` | `ObjectId` | |
| `repo_id` | `string` | FK → `OnboardedRepo.repo_id` |
| `kind` | `"epic" \| "subtask" \| "pull_request" \| "deploy"` | |
| `artifact_id` | `string` | GitHub id |
| `epic_id` | `string \| null` | Link to parent Epic; null for the Epic itself |
| `parent_subtask_id` | `string \| null` | For PRs and deploys linked to a sub-task |
| `title` | `string` | Sanitized for rendering |
| `body_excerpt` | `string` | First ~280 chars, sanitized |
| `state` | `"open" \| "closed" \| "merged" \| "in_progress" \| "success" \| "failure" \| "cancelled" \| "unknown"` | Native GitHub state |
| `current_stage` | `ShipLoopStage` | Derived (see resolver) |
| `assignees` | `string[]` | GitHub logins |
| `requested_reviewers` | `string[]` | For PRs |
| `labels` | `string[]` | All current labels |
| `agent_labels` | `string[]` | Subset of `labels` matching the configured agent-label prefix |
| `needs_human` | `boolean` | True if the stage is `Review (HITL)` or any stalled blocker |
| `stalled_since` | `Date \| null` | Set when the artifact has been in its current stage past the threshold |
| `last_event_at` | `Date` | |
| `github_url` | `string` | Canonical link |
| `created_at` | `Date` | |
| `updated_at` | `Date` | |

**Compound key**: `(repo_id, kind, artifact_id)` — unique.

---

### Embedded / derived types

#### `ShipLoopStage`

```ts
type ShipLoopStage =
  | "specify"
  | "plan"
  | "tasks"
  | "implement"
  | "review_hitl"
  | "merge"
  | "deploy"
  | "observe"
  | "blocked"
  | "unknown";
```

#### `HitlActionPayload` (for `source="ui"` events)

```ts
type HitlActionPayload = {
  action: "approve_pr" | "request_changes" | "comment" | "retry_deploy" | "pause_loop" | "resume_loop";
  target_artifact_id: string;
  comment?: string;        // sanitized at write
  outcome?: "ok" | "error";
  error_message?: string;  // server-supplied; never user-supplied
};
```

## Relationships

```text
OnboardedRepo (1) ────< ShipLoopEvent (N)
OnboardedRepo (1) ────< ShipLoopArtifact (N)
ShipLoopArtifact[kind=epic] (1) ────< ShipLoopArtifact[kind=subtask] (N)  via epic_id
ShipLoopArtifact[kind=subtask] (1) ────< ShipLoopArtifact[kind=pull_request|deploy] (N)  via parent_subtask_id
```

## Stage resolution rules

The pure function `resolveStage(events, labels, githubState) → ShipLoopStage` lives in `ui/src/lib/agentic-sdlc/stage-resolver.ts`. The rules, in order of precedence (highest first):

1. **Native GitHub terminal states** — e.g., a PR with `state="merged"` and a successful `deployment_status` for the configured environment ⇒ `deploy` (or `observe` if a follow-up "verified" signal is present). A `deployment_status` of `failure` ⇒ `blocked` (annotated as a deploy failure).
2. **Agent labels** (configurable prefix, default `agent:`) — `agent:specify` → `specify`, `agent:plan` → `plan`, `agent:tasks` → `tasks`, `agent:implement` → `implement`, `agent:awaiting-review` → `review_hitl`, `agent:deploy-sandbox` → `deploy`, `agent:blocked` → `blocked`.
3. **Native PR review state** — PR open with `requested_reviewers.length > 0` and no agent stage label ⇒ `review_hitl`.
4. **Default** — `unknown` for new artifacts whose stage has not been signaled. UI shows them in a safe "Unstaged" bucket; never silently dropped.

Per-repo overrides in `OnboardedRepo.label_to_stage_overrides` are applied **before** rule (2), letting teams use their own label vocabulary without a code change.

## State transitions (for Epics and sub-tasks)

```text
        ┌───────────────────────────────────────────────────────────┐
        ▼                                                           │
  specify → plan → tasks → implement → review_hitl → merge → deploy → observe
        │           │          │           │           │
        └───────────┴──────────┴───────────┴───────────┴─→ blocked
                                                            │
                                          (resolved) ←──────┘
```

Transitions are derived; the system does not enforce a strict graph. Any stage may transition to `blocked`. Returning from `blocked` lands the artifact back in the most recent non-`blocked` stage from its event log (so reopening a PR after a blocking review goes back to `review_hitl`, not all the way to `specify`).

## Validation rules tied to FRs

| Rule | FR(s) |
|------|-------|
| Webhook events without a verifiable HMAC signature MUST NOT be inserted into `ship_loop_events`. | FR-025 |
| Repo `webhook_status` MUST be set to `degraded` if no events received within the configured idle threshold (default 24h) and the repo has had recent active artifacts. | FR-010 |
| `current_stage` derivation MUST be a pure function of `ship_loop_events`; no read can return a stage that contradicts the event log. | FR-007, FR-008 |
| Sanitized fields (`title`, `body_excerpt`, comment text shown in UI) MUST be sanitized at write time *and* re-sanitized at render time (defense in depth). | FR-027, FR-028 |
| HITL events MUST always carry `actor_login` and a non-null user id; never accept anonymous `source="ui"` writes. | FR-026 |
| Reads from any of the three collections MUST be gated by `Config.shipLoopEnabled` and per-user feature flag at the API layer. | (toggle gating per plan §Constraints) |
