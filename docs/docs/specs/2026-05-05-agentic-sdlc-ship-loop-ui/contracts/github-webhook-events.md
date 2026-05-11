# GitHub Webhook Events Contract — Ship Loop

The Ship Loop subscribes to a fixed set of GitHub webhook events. Anything outside this list is ignored (returned `204` to keep GitHub deliveries healthy) and not persisted.

## Subscribed events

| Event | Actions consumed | Drives |
|-------|------------------|--------|
| `issues` | `opened`, `edited`, `labeled`, `unlabeled`, `assigned`, `unassigned`, `closed`, `reopened` | Epic + sub-task state, agent-stage labels, "Needs you" assignment |
| `issue_comment` | `created`, `edited` | Timeline entries; agent progress notes |
| `pull_request` | `opened`, `edited`, `labeled`, `unlabeled`, `review_requested`, `review_request_removed`, `synchronize`, `closed`, `reopened`, `ready_for_review` | PR state, links to sub-tasks (via body refs), Review-HITL detection |
| `pull_request_review` | `submitted`, `edited`, `dismissed` | HITL outcomes (approve/changes-requested) |
| `pull_request_review_comment` | `created`, `edited` | Timeline entries |
| `push` | (no action filter) | Detect commits without an associated PR; populate Implement-stage events |
| `check_run` | `completed`, `created` | Harness/CI status overlay on PR cards |
| `check_suite` | `completed` | Aggregate CI status |
| `deployment` | (no action filter) | Mark Deploy stage start; only when `environment` matches the repo's `sandbox_environment` |
| `deployment_status` | (no action filter) | Deploy success/failure terminal states |
| `label` | `created`, `edited`, `deleted` | Keep label catalog and stage mapping current |

## Fields read (per event)

We persist the entire verified payload (`ship_loop_events.payload`) but the projector reads only a stable subset. Examples:

- `pull_request`: `pull_request.id`, `.number`, `.node_id`, `.title`, `.body`, `.state`, `.merged`, `.draft`, `.user.login`, `.user.type`, `.assignees[].login`, `.requested_reviewers[].login`, `.labels[].name`, `.html_url`, `.head.ref`, `.base.ref`, `.head.sha`.
- `pull_request_review`: `review.state` (`approved` | `changes_requested` | `commented`), `review.user.login`, `review.submitted_at`.
- `deployment_status`: `deployment_status.state` (`success` | `failure` | `error` | `inactive` | `pending` | `in_progress` | `queued`), `deployment.environment`, `deployment.id`.
- `issues`: `issue.id`, `.number`, `.node_id`, `.title`, `.body`, `.state`, `.user.login`, `.user.type`, `.labels[].name`, `.assignees[].login`.

## Epic ↔ sub-task ↔ PR link resolution

We resolve linkage in this order, first match wins, no machine-magic:

1. **Explicit body reference** — `Closes #N`, `Fixes #N`, `Refs #N`, or full URL form. Standard GitHub-recognized references.
2. **Issue / Epic label** — sub-tasks carrying an `epic:<epic-number>` label (configurable prefix).
3. **Branch name convention** — `epic/<n>/...` or `<owner>/epic-<n>` (configurable regex; default off).
4. **Last-resort: same-author + recent-time heuristic** — explicitly **not** used. We prefer leaving the link unresolved (showing the artifact as "Unlinked") over guessing.

Unlinked artifacts surface in a dedicated "Unlinked" bucket on the per-repo view so the user can manually associate them.

## Agent vs. human actor classification

`actor_kind` is derived as follows (first match wins):

1. If the GitHub user `type === "Bot"` and the bot login matches the configured agent list (env: `SHIP_LOOP_AGENT_BOT_LOGINS`, comma-separated), classify as `agent`.
2. If the `installation.id` matches a configured agent GitHub App installation id, classify as `agent`.
3. If the action involves a label whose name starts with the configured agent label prefix (`agent:` by default), classify as `agent`.
4. Otherwise, classify as `human`.

System-emitted events (e.g., GitHub auto-merge, branch deletion) are classified as `system`.

## Verification rejection rules (FR-025)

Webhook deliveries are rejected (and never persisted) when **any** of the following are true:

- Missing or invalid `X-Hub-Signature-256` header.
- HMAC mismatch against the per-repo secret.
- Missing `X-GitHub-Delivery` header.
- Body fails to parse as JSON, or required envelope fields (`repository.id`) are missing.
- The `repository.id` does not correspond to an active onboarded repo (offboarded repos accept and discard events).

Rejected requests return `401` (signature) or `400` (malformed) and emit a structured server log line; they do not feed into the event log.
