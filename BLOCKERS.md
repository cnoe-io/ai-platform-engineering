# Blockers and Deferred Work

This file tracks work items that were intentionally deferred during the
comprehensive RBAC push (specs 098 / 102 / 103) so the next session has
a clean checklist of what remains and **why** it was deferred.

Branch: `prebuild/feat/comprehensive-rbac`
Last updated: 2026-04-23

---

## 1. Spec 102 — Comprehensive RBAC Tests and Completion

The branch closes out the high-impact RBAC gaps (DA Phase 8 fixes the
live HTTP 401, supervisor PDP gate is feature-flagged, BFF error
contract is standardized). The remaining items are large but lower
risk:

### 1.1 Per-MCP RBAC migrations (Phase 8 follow-on)

12 MCP servers still authenticate via the legacy
`X-User-Context`-derived header pattern at the `agentgateway` layer.
The DA → agentgateway hop is now JWT-based; the **agentgateway →
upstream MCP** hop still relies on agentgateway's local
authentication. Each upstream MCP needs:

- A Keycloak `mcp_<name>` resource with `invoke` scope.
- A realm permission binding `chat_user` to that resource.
- The MCP server's own JWT validation middleware.

MCPs to migrate (one Spec 102 task per server, tracked separately):

| MCP server | Status |
|---|---|
| jira | not migrated |
| confluence | not migrated |
| argocd | not migrated |
| github | not migrated |
| slack | not migrated |
| backstage | not migrated |
| pagerduty | not migrated |
| splunk | not migrated |
| webex | not migrated |
| servicenow | not migrated |
| aws | not migrated |
| komodor | not migrated |

**Why deferred**: Each migration is at least a half-day of work
(realm config + middleware + integration test) and the chain is
guarded today by the trusted-network assumption between
agentgateway and the MCP servers (same docker network /
namespace). The DA→agentgateway hop was the user-facing leak.

### 1.2 Slack OBO live verification (Phase 9)

The OBO exchange path (`obo_exchange.py` in DA + the existing
`caipe-slack-bot` token-exchange config in Keycloak) is unit-tested
but has not been executed end-to-end against a live Keycloak with
real Slack-bot OAuth flows. Required steps documented in
`CHECKLIST.md`.

### 1.3 RAG hybrid ACL (Phase 7 follow-on)

RAG server already enforces group-based ACL on namespace queries.
The "hybrid ACL" promotion (collection-level filter combined with
per-document tags) requires a schema migration and is sized
separately.

### 1.4 US7 e2e Playwright runs (Phase 10)

US7 calls for full browser-driven regression of the BFF auth contract
across sign-in, sign-out, expired-session, missing-role, and
PDP-down paths. The supporting unit tests are in place
(`ui/src/lib/__tests__/auth-error.test.ts`,
`ui/src/lib/streaming/__tests__/stream-error.test.ts`); the
Playwright harness itself is not yet wired into CI.

### 1.5 US8 doc validator (Phase 10)

US8 wants a CI-side validator that asserts every RBAC code change
also touches the canonical reference doc. The validator design is
not yet written.

### 1.6 Phase 11 — performance / cleanup

Not started:
- Decision-cache observability (hit/miss metrics).
- Audit log shipping to centralized sink.
- Removal of the dual-auth `X-User-Context` legacy path once the
  BFF migration is fully baked. Today the new `JwtAuthMiddleware`
  is intentionally lenient (no Bearer => pass through) so the
  legacy path keeps working; flip `DA_REQUIRE_BEARER=true` once
  every BFF caller is sending a Bearer.
- Bench: PDP cache TTL tuning.

---

## 2. Spec 103 — Slack JIT user creation

Spec 103 is **docs-complete** (research.md + security-review.md
landed on this branch). Tasks T031–T035 are live-verification only
and require real Slack DMs:

- T031: First-time Slack DM creates Keycloak user (verify in admin UI).
- T032: Second DM from same user reuses existing record.
- T033: DM from disallowed email domain shows "ask admin".
- T034: Audit log shows `created_by=slack_bot`, `created_at`,
  `slack_user_id`.
- T035: User logs in via web later, attributes survive
  (`syncMode=IMPORT` regression check).

Steps documented in `CHECKLIST.md`.

---

## 3. Pre-existing test failures (NOT introduced by this branch)

Verified on baseline `git stash`:

- `ai_platform_engineering/dynamic_agents/tests/test_sse_error_sanitization.py`
  — 2 tests fail due to a missing `encoder` arg on
  `_generate_resume_sse_events`. This is unrelated to RBAC; the
  signature drift predates this branch.
- `ai_platform_engineering/multi_agents/tests/...test_ai.py` (5 cases)
  — confirmed pre-existing during the JIT commit cycle.

Both are tracked separately and will not block merging this branch.

---

## 4. Notable design decisions captured this session

- DA's `JwtAuthMiddleware` is **lenient by default** (`DA_REQUIRE_BEARER`
  unset) so the legacy `X-User-Context` path keeps working during
  the rollout. Flip the env var once every caller sends a Bearer.
- Forged Bearer headers always **hard-fail 401** — they never silently
  fall through to the trusted-header path. This is enforced both in
  middleware code and by `test_no_x_user_context_in_outbound_paths.py`.
- Supervisor PDP gate is **feature-flagged** (`SUPERVISOR_PDP_GATE_ENABLED`)
  so we can ship the middleware without affecting any deployment that
  hasn't yet rolled out the matching Keycloak permissions.
- OBO exchange in DA falls back to **forwarding the original token**
  on any error — this is the safest behaviour while OBO config rolls
  out per-environment and matches the supervisor's pattern.
