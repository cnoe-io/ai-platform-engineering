# Tasks: Workflow RBAC on CAS (re-implementation of #1751)

**Date:** 2026-06-07
**Stacked on:** PR #1770 (CAS foundation) — branch `feat/centralized-authz-service`
**Supersedes:** PR #1751
**Companions:** [`../2026-06-06-cas-implementation/spec.md`](../2026-06-06-cas-implementation/spec.md) · [`architecture.md`](../2026-06-06-cas-implementation/architecture.md) · [`research.md`](../2026-06-06-cas-implementation/research.md)

## Goal

Re-implement #1751 (workflow RBAC: visibility, run access, team sharing, execution authz, editor UX) on top of CAS — and resolve the #1751 review feedback.

## Addresses #1751 review comments

| Comment | Resolution here |
|---|---|
| **@subbaksh** on `workflow_execution_authz.py` — *"Workflows are a UI-server concept; RBAC for invocation should be in the UI server, not DA."* | Per-step agent-use gate moves into the BFF `executeSteps()`; **`workflow_execution_authz.py` is deleted**. DA reads no `workflow_configs`. |
| **@subbaksh** on `workflow-da-auth.ts` — *"Why send user/email in a header and have DA trust it?"* | Workflow authz no longer depends on `X-User-Context`. Header survives only for `get_user_context()` email; cleanup tracked in **#1753**. |
| **code-quality bot** — unused import in `workflow-run-access.ts` | File is replaced by CAS `authorize` / `filterAccessible`. |

## Architecture note

The BFF `executeSteps()` **orchestrates the workflow and invokes agents one step at a time** (`/api/v1/chat/stream/start` per step). So the per-step CAS gate runs **in-process in the BFF** — no DA→CAS cross-process delegation, no decision tokens, no shared run registry. Direct agent chat still migrates DA's `openfga_authz.py` → CAS HTTP check.

## Decisions (locked)

- **Standing grants** — sharing writes `team→agent` tuples; global workflows write a `user:* can_use agent` wildcard.
- **CAS owns grants** via an intent-based PAP (`PolicyAdmin`); meta-authz: caller must **manage the agent** being granted.
- **Full #1751 parity** (including editor UX).
- **Drop** the `domains/workflow.ts` delegation stub.

## Phases

### Phase 1 — CAS grant API (PAP)
- [ ] `PolicyAdmin` interface + `OpenFgaPolicyAdmin` (tuple write/delete transport)
- [ ] `grant()` / `revoke()` in `lib/authz`; `GrantIntent` contract type
- [ ] `POST` / `DELETE /api/authz/v1/grants` — JWKS verify + meta-authz (caller manages resource)
- [ ] `cas_grant` audit event
- [ ] unit + contract tests

### Phase 2 — Workflow data model + BFF read/use
- [ ] `visibility` / `shared_with_teams` / `owner_id` on workflow config (model + seed)
- [ ] `workflow-configs` route → CAS read/write/delete; runs `cancel`/`resume` → CAS
- [ ] list filtering via `filterAccessible`

### Phase 3 — BFF per-step execution gate (addresses @subbaksh #3)
- [ ] `authorize({user, step.agent_id, use})` in `executeSteps()` before `chat/stream/start`
- [ ] same gate in `resumeAndContinue()` before `chat/stream/resume`
- [ ] DENY → fail step with a clean reason; audit

### Phase 4 — DA cleanup (addresses @subbaksh #3 + #2)
- [ ] delete `workflow_execution_authz.py` + its test
- [ ] migrate `openfga_authz.py` (direct chat) → CAS HTTP check
- [ ] `X-User-Context` reduced to email-only; link #1753

### Phase 5 — Share / modal via CAS grant API
- [ ] `WorkflowAgentAccessModal` → `POST /api/authz/v1/grants` (team→agent, global→`user:*`)
- [ ] remove direct OpenFGA admin writes from the modal path

### Phase 6 — Editor UX parity
- [ ] unsaved-changes badge + discard dialog
- [ ] `WorkflowCanvas` / `WorkflowSidebar` / `WorkflowStepSidebar` / `WorkflowToolbar`

### Phase 7 — Cleanup + verify
- [ ] drop `domains/workflow.ts` stub
- [ ] fix unused import (bot comment)
- [ ] parity + regression tests; full suite green; coverage
- [ ] reply to #1751 threads; mark #1751 superseded by this PR

<!-- assisted-by claude code claude-opus-4-8 -->
