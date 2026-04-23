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

### 1.1 Per-MCP RBAC migrations (Phase 8 follow-on) ✅ DONE 2026-04-22

**Resolution**: rather than write per-MCP JWT middleware (the original
plan), we route each MCP through `agentgateway`, which already enforces
JWT validation (issuer/audience/JWKS) and CEL-based MCP authorization
pulled from MongoDB via `ag-config-bridge`. The 12 migrations therefore
collapse to:

  - Adding the standalone MCPs to `SEED_BACKENDS` in
    `deploy/agentgateway/config-bridge.py` (10 new backends).
  - Adding a default `chat_user / team_member / kb_admin / admin` invoke
    CEL policy per backend.
  - Asserting structural invariants in
    `tests/test_ag_config_bridge_seeds.py` (9 tests).

| MCP server | Status |
|---|---|
| jira | gateway-routed (mcp_jira) |
| confluence | gateway-routed (mcp_confluence) |
| argocd | gateway-routed (mcp_argocd) |
| github | gateway-routed (mcp_github) |
| slack | gateway-routed (mcp_slack) |
| backstage | gateway-routed (mcp_backstage) |
| pagerduty | gateway-routed (mcp_pagerduty) |
| splunk | gateway-routed (mcp_splunk) |
| webex | gateway-routed (mcp_webex) |
| komodor | gateway-routed (mcp_komodor) |
| aws | embedded in agent-aws (not gateway-routable) |
| servicenow | embedded in agent-servicenow (not gateway-routable) |

Operators can tighten the default policies per-tool through
**Admin UI > Security & Policy > AG MCP Policies** (e.g. require
`team_member` for `*_create` / `*_delete` patterns).

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

### 1.5 US8 doc validator (Phase 10) ✅ DONE 2026-04-23

- `scripts/validate_rbac_docs.py` walks the PR diff and fails when
  RBAC-relevant code (auth helpers, middleware, BFF auth surface,
  agentgateway seed, Keycloak bootstrap) changes without a matching
  edit to `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md`.
- Carve-outs: tests, markdown, BLOCKERS/CHECKLIST. Adding a path to
  `RBAC_PATHS` in the script extends the gate.
- Wired into CI via `.github/workflows/validate-rbac-docs.yml`
  (runs on every PR targeting `main` or `release/**`).
- Tests: `tests/test_validate_rbac_docs.py` (23 tests; classifier
  cases + 5 end-to-end runs against a temp git repo).

### 1.6 Phase 11 — performance / cleanup

- Decision-cache observability ✅ DONE 2026-04-22
  - `ai_platform_engineering/utils/auth/metrics.py` — Prometheus counters/histogram
    (`rbac_pdp_decisions_total`, `rbac_pdp_cache_hits_total`,
    `rbac_pdp_cache_misses_total`, `rbac_pdp_request_seconds`).
  - Wired into `keycloak_authz.py` decision sites and timed Keycloak round-trips.
  - DA exposes `/metrics` (supervisor already did).
  - Tests: `tests/test_rbac_pdp_metrics.py` (6 tests).
- Audit log shipping to centralized sink. ✅ DONE 2026-04-22
  - Added optional stdout JSON sink in `utils/auth/audit.py` gated on
    `AUDIT_STDOUT_ENABLED=true` (best-effort, independent of Mongo write).
  - Each line: `AUDIT {...schema-conformant payload, ts ISO-8601 UTC...}\n`.
  - Operator docs + fluent-bit example in
    `scripts/audit-log-shipping/{README.md,fluent-bit.conf}`.
  - Tests: `tests/test_audit_stdout_sink.py` (9 tests, sink-independence
    verified).
- Removal of the dual-auth `X-User-Context` legacy path. ✅ DONE 2026-04-23
  - `docker-compose.dev.yaml` now defaults `DA_REQUIRE_BEARER=true` for
    the `dynamic-agents` service.
  - Two outlier BFF callers (`ui/src/app/api/dynamic-agents/assistant/suggest`
    and `ui/src/app/api/mcp-servers/probe`) were migrated from manual
    header building to the shared `buildBackendHeaders()` so they always
    forward `Authorization: Bearer <token>` alongside `X-User-Context`.
  - `da-proxy.ts` was already on the shared helper, so all DA-bound
    traffic now carries Bearer.
  - **Rollback**: set `DA_REQUIRE_BEARER=false` (or unset) in `.env`
    and recreate the `dynamic-agents` container; the middleware reverts
    to lenient mode and the legacy `X-User-Context` path keeps working.
  - The `X-User-Context` header itself is still forwarded for now — it
    feeds DA's claim-hint logic but is no longer authoritative. Removing
    it entirely is tracked as a follow-up after one release cycle of
    soak time on the Bearer-only path.
- Bench: PDP cache TTL tuning. (operator-driven, depends on metrics above)

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
