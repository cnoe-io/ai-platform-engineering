# Implementation Plan: Comprehensive RBAC Tests + Completion of 098

**Branch**: `prebuild/feat/comprehensive-rbac` (existing — do **not** create a new branch; FR-015) | **Date**: 2026-04-22 | **Spec**: [`spec.md`](./spec.md)
**Input**: Feature specification at `docs/docs/specs/102-comprehensive-rbac-tests-and-completion/spec.md`

**Companion docs**:

- [`spec.md`](./spec.md) — what & why (8 user stories, 15 FRs, 6 personas)
- [`call-sequences.md`](./call-sequences.md) — code-level sequence diagrams (real `file:function` references) for every flow this spec touches
- [`research.md`](./research.md) — Phase 0 output (this command)
- [`data-model.md`](./data-model.md) — Phase 1 output (this command)
- [`quickstart.md`](./quickstart.md) — Phase 1 output (this command)
- [`contracts/`](./contracts/) — Phase 1 output (this command)

## Summary

Close every authorization gap identified between [spec 098](../098-enterprise-rbac-slack-ui/spec.md) and the post-merge state of `prebuild/feat/comprehensive-rbac`, then prove the closure with a comprehensive, matrix-driven test suite that runs against a real Keycloak (no mocks for the PDP).

The work is one PR (`#1257`, FR-015). It lands in **5 sequential phases**, each gated on green tests for the prior phase. The biggest delta is Phase 4 (Custom Agents — 5 layers of changes per `call-sequences.md` Flow 4) which is the riskiest and is therefore deliberately kept after the simpler BFF migration is locked in by Phase 1.

**Scope sanity check**: ~25 files modified, ~12 new files, ~120 new test cases, 1 new docker-compose file, 1 new Make target, 4 new automation scripts, 1 doc rewrite. Implementation effort: estimated 6-10 working days for a single engineer; trivially parallelizable across phases for two.

## Technical Context

**Language/Version**:
- Python 3.11+ (supervisor, dynamic_agents, RAG server, agent MCPs, slack bot)
- TypeScript / Next.js 16 + React 19 (UI BFF + Playwright suite)

**Primary Dependencies**:
- LangGraph, LangChain, FastAPI, A2A Protocol, deepagents (≥0.3.8) — Python
- NextAuth.js, Keycloak Authorization Services, MongoDB, Tailwind CSS, shadcn/ui — TypeScript
- `@slack/web-api`, Slack Bolt (Python) — Slack bot
- Playwright (NEW for this spec — already used in repo for non-RBAC E2E)
- Existing: `cel-python` (Python CEL), `cel-js` (TypeScript CEL)

**Storage**:
- Keycloak (users, realm/client roles, user attributes, sessions, AuthZ Services policies/resources/scopes) — single source of truth for identity & policy
- MongoDB — `teams`, `team_kb_ownership`, `slack_link_nonces`, `slack_user_metrics`, **`authz_decisions`** (NEW), `audit_events` (existing dual-write target)
- In-process: PDP decision cache (TS `permissionDecisionCache`, Python equivalent NEW), JWKS cache (existing), userinfo cache (existing)

**Testing**:
- Jest (TS) — BFF unit tests, parameterised over personas
- pytest (Py) — middleware unit tests, parameterised over personas
- Playwright — end-to-end browser tests against `docker-compose.dev.yaml` driven by `COMPOSE_PROFILES` (per [spec Clarification 2026-04-22](./spec.md#session-2026-04-22)) plus a thin `docker-compose/docker-compose.e2e.override.yaml` for port remaps
- `make test-rbac` (NEW) — single orchestration target

**Target Platform**:
- Linux server (production); macOS / Linux dev environments
- Docker Compose for local dev and CI E2E
- Helm-deployed in production (chart updates out of scope for this spec)

**Project Type**: Web application — multi-service backend (Python FastAPI / A2A) + Next.js frontend with BFF pattern.

**Performance Goals**:
- PDP cache hit ratio ≥80% in steady-state (existing TTL = 60s, accepted as-is per spec out-of-scope)
- `make test-rbac` total wall time ≤ 10 minutes locally on M-series Mac, ≤ 12 minutes in CI (SC-005, SC-008)
- JWKS cache TTL ≥ 5 minutes per FR-002

**Constraints**:
- No new branches (FR-015) — single PR `#1257`
- No NextAuth replacement, no MongoDB replacement, no CEL evaluator replacement (spec out-of-scope)
- Default-deny on PDP-unavailable for resources without an explicit fallback rule (spec edge case + Open Question 1, recommendation accepted)
- Audit-log write failure MUST NOT cause gate to fail open (FR-007)
- Shared-key auth for MCPs MUST be removed (not deprecated-with-warning) per FR-012

**Scale/Scope**:
- ~15 BFF routes to migrate from `requireAdmin` → `requireRbacPermission`
- ~12 agent MCP servers to migrate from `SharedKeyMiddleware` → `JwtUserContextMiddleware` + `requireRbacPermission`
- 1 RAG server, 1 dynamic_agents backend, 1 slack bot to gain a uniform Python middleware
- 6 personas × ~30 protected endpoints × ~3 scopes = ~500 test cases (reduced via matrix parameterisation to ~120 unique test functions)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (see end of file).*

Constitution principles evaluated against this plan (per `.specify/memory/constitution.md`):

| Principle | Status | Notes |
|---|---|---|
| **I. Worse is Better** | ✅ Pass | Plan deliberately reuses the existing `requireRbacPermission` / `JwtUserContextMiddleware` patterns rather than building a new abstraction. Python helpers are mechanical translations of TypeScript helpers. |
| **II. YAGNI** | ✅ Pass | No speculative features. Every NEW file maps directly to a numbered FR or user story. PDP cache, CEL layer, role fallback are all kept as-is. |
| **III. Rule of Three** | ⚠️ Justified deviation | Two new TS↔Py mirrors are introduced (`requireRbacPermission`, `logAuthzDecision`) on first use, not third. **Justified** in Complexity Tracking — they are exact behavioural mirrors of existing code, and writing them once each in TS and Py is the simplest implementation given the polyglot trust boundary. |
| **IV. Composition over Inheritance** | ✅ Pass | All new modules are functions or middleware classes consumed via composition (`withAuth(req, handler)`, FastAPI `Depends(...)`). No class hierarchies. |
| **V. Specs as Source of Truth** | ✅ Pass | This is a spec-driven flow; `tests/rbac-matrix.yaml` becomes the in-code source of truth that the spec mandates and CI validates (FR-010). |
| **VI. CI Gates Are Non-Negotiable** | ✅ Pass | New `make test-rbac` target runs in CI; `scripts/validate-rbac-matrix.py` and `scripts/validate-rbac-doc.py` are hard gates (FR-010, FR-014, SC-006). |
| **VII. Security by Default** | ✅ Pass | Default-deny on PDP-unavailable; no secrets in code; JWKS verification at every Python service; OBO tokens (not service-account passthrough) at every hop; explicit removal of forgeable `X-User-Context` trust. |

**Coding Practices**:
- Type hints required (FR-003 implementations will follow)
- Docstrings on all new public helpers
- `loguru` for Python logging; `console.log` for TS audit log JSON (existing pattern)
- Constants centralised in `tests/rbac-matrix.yaml` and `deploy/keycloak/realm-config.json`

**Result**: ✅ Constitution Check passes with one justified deviation (Rule of Three for TS↔Py mirrors), tracked in [Complexity Tracking](#complexity-tracking).

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/102-comprehensive-rbac-tests-and-completion/
├── spec.md                  # Feature spec (already written)
├── call-sequences.md        # Code-level sequence diagrams (already written)
├── plan.md                  # This file
├── research.md              # Phase 0 — Open Questions resolved + tech decisions
├── data-model.md            # Phase 1 — entities, schemas, transitions
├── quickstart.md            # Phase 1 — local & CI usage
├── contracts/               # Phase 1 — interface contracts
│   ├── audit-event.schema.json    # authz_decisions document shape
│   ├── rbac-matrix.schema.json    # tests/rbac-matrix.yaml shape
│   ├── realm-config-extras.schema.json  # PDP-unavailable fallback rules
│   └── python-rbac-helper.md      # Python `requireRbacPermission` API contract
└── tasks.md                 # Phase 2 output (NOT this command — see /speckit.tasks)
```

### Source Code (repository root)

This is a polyglot web application; structure already exists in the repo and is reused. The plan is **modifications and additions** within these existing trees, **not** a new project layout.

```text
ai_platform_engineering/
├── multi_agents/platform_engineer/protocol_bindings/a2a/
│   ├── main.py                       # MODIFIED: middleware stack already correct (preserved as-is)
│   └── agent_executor.py             # MODIFIED: OBO mint already correct (test coverage NEW)
├── utils/auth/
│   ├── jwt_context.py                # PRESERVED
│   ├── jwt_user_context_middleware.py # PRESERVED
│   ├── token_context.py              # PRESERVED (used by supervisor MCP factory)
│   ├── jwks_validate.py              # NEW (FR-002 — Python JWKS validator)
│   ├── keycloak_authz.py             # NEW (FR-003 — Python `require_rbac_permission`)
│   └── audit.py                      # NEW (FR-007 — Python `log_authz_decision`)
├── utils/obo_exchange.py             # PRESERVED (supervisor OBO)
├── utils/a2a_common/base_langgraph_agent.py  # PRESERVED (supervisor MCP factory)
├── dynamic_agents/src/dynamic_agents/
│   ├── auth/
│   │   ├── auth.py                   # MODIFIED: drop X-User-Context trust (FR-004)
│   │   ├── access.py                 # MODIFIED: add Keycloak PDP call (defense-in-depth)
│   │   ├── jwt_middleware.py         # NEW (mirrors supervisor JwtUserContextMiddleware)
│   │   ├── keycloak_authz.py         # NEW (DA-side wrapper around utils.auth.keycloak_authz)
│   │   ├── token_context.py          # NEW (DA ContextVar mirrors supervisor)
│   │   └── obo_exchange.py           # NEW (DA OBO client mirrors supervisor)
│   └── services/
│       ├── agent_runtime.py          # MODIFIED: set ContextVar at entry; remove _auth_bearer attr
│       └── mcp_client.py             # MODIFIED: NEW httpx_client_factory (FR-005)
├── knowledge_bases/rag/
│   └── server/                       # MODIFIED: add JwtUserContextMiddleware + hybrid gate (FR-013)
├── agents/
│   ├── argocd/mcp/                   # MODIFIED: shared key → Keycloak (FR-012)
│   ├── aws/mcp/                      # MODIFIED: same
│   ├── jira/mcp/                     # MODIFIED: same
│   ├── github/mcp/                   # MODIFIED: same
│   ├── pagerduty/mcp/                # MODIFIED: same
│   ├── splunk/mcp/                   # MODIFIED: same
│   ├── confluence/mcp/               # MODIFIED: same
│   ├── webex/mcp/                    # MODIFIED: same
│   ├── slack/mcp/                    # MODIFIED: same
│   ├── komodor/mcp/                  # MODIFIED: same
│   ├── aigateway/mcp/                # MODIFIED: same
│   └── backstage/mcp/                # MODIFIED: same
└── integrations/slack_bot/
    ├── app.py                        # MODIFIED: use impersonate_user per command (FR-011)
    ├── utils/obo_exchange.py         # PRESERVED
    └── utils/rbac_middleware.py      # MODIFIED: remove channel-allowlist gate

ui/src/
├── lib/
│   ├── api-middleware.ts             # MODIFIED: deprecate requireAdmin/requireAdminView usage in production routes
│   ├── rbac/
│   │   ├── keycloak-authz.ts         # PRESERVED
│   │   ├── audit.ts                  # PRESERVED
│   │   ├── types.ts                  # MODIFIED: add new resources/scopes
│   │   └── matrix-loader.ts          # NEW (loads tests/rbac-matrix.yaml at build time)
│   └── da-proxy.ts                   # MODIFIED: drop X-User-Context construction (FR-004)
└── app/api/
    ├── admin/**/route.ts             # MODIFIED (~5 routes): requireAdmin → requireRbacPermission
    ├── dynamic-agents/route.ts       # MODIFIED: requireAdmin → requireRbacPermission
    ├── mcp-servers/**/route.ts       # MODIFIED (~3 routes): same
    ├── teams/**/route.ts             # MODIFIED (~3 routes): same
    ├── agents/**/route.ts            # MODIFIED (~3 routes): same
    └── v1/chat/stream/start/route.ts # MODIFIED: ADD requireRbacPermission (currently has none)

deploy/keycloak/
├── realm-config.json                 # MODIFIED (FR-006): seed all resources/scopes
├── realm-config-extras.json          # NEW (Open Q1): per-resource PDP-unavailable fallback rules
└── docker-compose.yml                # MODIFIED (Open Q4): enable token-exchange feature

docker-compose/
└── docker-compose.e2e.override.yaml  # NEW (FR-008, [spec Clarification 2026-04-22](./spec.md#session-2026-04-22)):
                                      # thin overlay on docker-compose.dev.yaml; remaps host ports
                                      # only — no service duplication. Driven by COMPOSE_PROFILES.

tests/
└── rbac/                             # NEW (Open Q2 recommendation accepted)
    ├── rbac-matrix.yaml              # NEW (FR-010): single source of truth
    ├── conftest.py                   # NEW: pytest persona-token fixture (FR-008)
    ├── fixtures/
    │   ├── keycloak.py               # NEW: Python persona helper
    │   ├── keycloak.ts               # NEW: TypeScript persona helper (consumed by Jest + Playwright)
    │   └── audit.py / audit.ts       # NEW: assertion helpers for authz_decisions writes
    ├── unit/
    │   ├── ts/                       # NEW: Jest BFF tests parameterised over matrix
    │   └── py/                       # NEW: pytest middleware tests parameterised over matrix
    └── e2e/                          # NEW: Playwright suite (8 user journeys)

scripts/
├── validate-rbac-matrix.py           # NEW (FR-010): CI linter — every protected route in matrix
├── validate-rbac-doc.py              # NEW (FR-014): CI linter — file map current
├── extract-rbac-resources.py         # NEW (FR-006): emit KeycloakResourceCatalog from code
└── validate-realm-config.py          # NEW (FR-006): assert realm-config covers code

Makefile                              # MODIFIED: add `test-rbac` target (FR-009)
```

**Structure Decision**: This is a **web application** (multi-service backend + frontend BFF). The repo already has the canonical layout — backend under `ai_platform_engineering/`, frontend under `ui/`. No new project type is introduced. The new top-level `tests/rbac/` directory is justified by Open Question 2's accepted recommendation: a single repo-root location for the matrix and persona fixtures, with thin shims in each component's existing test runner. Component-local test trees (`ui/src/app/api/__tests__/`, `tests/`) are preserved and untouched except where they must be updated to consume the new fixtures.

## Phases

The 8 user stories collapse into **5 implementation phases** ordered by risk-asc and dependency-asc. Each phase ends with a green-light checkpoint (matrix-test pass + reviewer signoff). The phases are explicitly designed so each one is **independently shippable**: Phase 1 alone is a real security improvement even if Phases 2-5 slip. This is per Constitution principle I (Worse is Better) — bias toward visible incremental delivery over a single big-bang merge.

### Phase 0 — Research, Schema, Fixtures (foundations)

**Outputs**: `research.md`, `data-model.md`, `quickstart.md`, `contracts/*.schema.json`, `tests/rbac/rbac-matrix.yaml` (skeleton), `tests/rbac/fixtures/keycloak.{py,ts}`, `deploy/keycloak/realm-config-extras.json` (skeleton with `admin_ui` rule), `deploy/keycloak/docker-compose.yml` enabling `--features=token-exchange`, `docker-compose/docker-compose.e2e.override.yaml` (thin port-remap overlay on `docker-compose.dev.yaml` per [spec Clarification 2026-04-22](./spec.md#session-2026-04-22)).

**Why first**: Every later phase consumes the matrix and the persona fixture. If these are wrong, every test in every phase has to be rewritten.

**Acceptance**:
- `make test-rbac` exists and runs (it can be vacuous — the tests will be filled in by later phases) and brings up the e2e compose stack to a healthy state in <2 minutes.
- The persona fixture mints a real Keycloak token for `alice_admin` and `bob_chat_user` against the seeded realm.
- All four schema files in `contracts/` exist and validate the seed data they describe.
- `scripts/validate-rbac-matrix.py` exists and passes against an empty matrix (no protected routes yet).

---

### Phase 1 — UI BFF Keycloak Migration (Story 1)

**Files modified**: ~15 routes under `ui/src/app/api/{admin,dynamic-agents,mcp-servers,teams,agents}/**/route.ts`. Plus `ui/src/lib/api-middleware.ts` (mark `requireAdmin`/`requireAdminView` as legacy, do not delete).

**Files added**: ~15 jest tests in `tests/rbac/unit/ts/` (one per route, persona-parameterised).

**Approach** (mechanical):
1. For each route, replace `requireAdmin(session)` with `await requireRbacPermission(session, '<resource>', '<scope>')`.
2. Add the `(route, resource, scope)` triple to `tests/rbac-matrix.yaml`.
3. Add the seed for `(resource, scope)` to `deploy/keycloak/realm-config.json` (FR-006).
4. Write the parameterised jest test file consuming the matrix.

**Acceptance**:
- `scripts/validate-rbac-matrix.py` finds zero unprotected routes.
- Every test in `tests/rbac/unit/ts/` passes for all 6 personas.
- `requireAdmin` has zero production callers (confirmed by `rg -l 'requireAdmin\(session\)' ui/src/app/api/`).

**Maps to**: Story 1, FR-001, FR-006, FR-010 (subset)

---

### Phase 2 — Python Service Hardening (Stories 2 + 3)

**Files added**: `ai_platform_engineering/utils/auth/{jwks_validate,keycloak_authz,audit}.py` — three Python helpers that mirror the TS implementations.

**Files modified**: every agent MCP server's `main.py` to register `JwtUserContextMiddleware` + replace `SharedKeyMiddleware` with the new `requireRbacPermission` dependency. Same for the supervisor (already partially done — verify and add tests).

**Approach**:
1. Implement Python helpers (see [`contracts/python-rbac-helper.md`](./contracts/python-rbac-helper.md) for the API contract).
2. For each MCP server, swap auth middleware. Wire `requireRbacPermission(token, '<agent>_mcp', 'read'|'write')` into every tool entry point.
3. Add the `(<agent>_mcp, read|write)` resources to `realm-config.json`.
4. Write parameterised pytest tests in `tests/rbac/unit/py/` per MCP server.
5. Confirm supervisor's existing `httpx_client_factory` propagates the OBO token end-to-end via a stub MCP server that records the inbound `Authorization` header.

**Acceptance**:
- pytest suite in `tests/rbac/unit/py/` passes for all 6 personas × all 12 MCPs × 2 scopes.
- A stub-MCP integration test asserts that a `bob_chat_user` request to the supervisor results in the stub seeing an `Authorization` header whose JWT has `sub=bob_chat_user.keycloak_sub` and `act.sub=supervisor-sa`.
- `rg -l 'SharedKeyMiddleware' ai_platform_engineering/agents/` returns zero results (FR-012).

**Maps to**: Stories 2 + 3, FR-002, FR-003, FR-007 (Python side), FR-012

---

### Phase 3 — RAG Hybrid Gate (Story 4)

**Files modified**: `ai_platform_engineering/knowledge_bases/rag/server/` — add `JwtUserContextMiddleware` and a per-route `requireRbacPermission` call (`rag#ingest` for `/v1/ingest`, `rag#retrieve` for `/v1/query`). Then add per-KB filtering: union of `TeamKbOwnership` (Mongo) and per-KB realm roles (`kb_reader:<id>`, `kb_ingestor:<id>`).

**Files added**: pytest suite in `tests/rbac/unit/py/test_rag_*.py` covering the 5 acceptance scenarios + edge cases (empty result set, KB exists but user lacks role, KB does not exist).

**Approach**:
1. Add `rag` resource (`ingest`, `retrieve`, `manage`) to `realm-config.json`.
2. Add the per-KB roles convention (`kb_reader:<id>`, `kb_ingestor:<id>`) — these are realm roles created by the team-management UI when a KB is provisioned. **Note**: per-KB role creation already exists in the team-management code from spec 098; this phase only consumes them.
3. Wire the hybrid gate: coarse Keycloak check → fine MongoDB + per-KB role filter inside the RAG service (FR-013).
4. Write tests using the `team-a-docs` / `team-b-docs` two-KB fixture from the spec's Independent Test.

**Acceptance**:
- Sentinel docs from `team-a-docs` are visible to `carol_kb_ingestor` (team-a member with `kb_ingestor:team-a-docs` role) and invisible to `bob_chat_user` (team-a member without the role).
- `dave_no_role` gets 403 on `/v1/query`.
- All 5 acceptance scenarios from Story 4 pass.

**Maps to**: Story 4, FR-002, FR-003, FR-013

---

### Phase 4 — Custom Agents Full Migration (Story 6) — **biggest delta**

This is the largest behaviour change. It implements **all 5 layers** identified in the audit and tracked under "full_da" in the spec's user-decisions log.

**Files added**:
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/jwt_middleware.py`
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/keycloak_authz.py`
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/token_context.py`
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/obo_exchange.py`

**Files modified**:
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/auth.py` — drop `X-User-Context` trust; `get_user_context()` reads from new ContextVar (FR-004)
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/access.py` — `can_view_agent`, `can_use_agent`, `can_access_conversation` now also call Keycloak PDP (defense-in-depth)
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` — set ContextVar at entry; remove `_auth_bearer` attribute
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mcp_client.py` — NEW `httpx_client_factory` reading from `current_user_token` ContextVar (FR-005)
- `ui/src/lib/da-proxy.ts` — drop `X-User-Context` construction; pass `Authorization` header through
- `ui/src/app/api/v1/chat/stream/start/route.ts` — ADD `requireRbacPermission(session, 'dynamic_agent:<agent_id>', 'invoke')`
- `ui/src/app/api/dynamic-agents/route.ts` — already covered in Phase 1, verify with new tests

**Approach**:
1. Add `dynamic_agent` resource (`view`, `invoke`, `manage`) and the per-agent resources convention (`dynamic_agent:<agent_id>`) to `realm-config.json`.
2. Implement the 4 new DA-side modules (mostly copies of the supervisor's equivalents — see [`call-sequences.md`](./call-sequences.md) Flow 4b).
3. Modify the 6 existing files in the order: `da-proxy.ts` and `chat/stream/start/route.ts` first (BFF gate), then DA backend changes (defense-in-depth).
4. Write tests:
   - jest: BFF allow/deny per persona per agent
   - pytest: DA backend allow/deny + the **forged-header-is-ignored** test (per Story 6 acceptance scenario 3)
   - pytest: MCP-tool-call-from-DA carries fresh OBO (per Story 6 acceptance scenario 4)
5. **Cleanup**: `rg "X-User-Context" ai_platform_engineering` MUST return only test fixtures and audit-log lines (SC-002).

**Acceptance**:
- All 5 Story 6 acceptance scenarios pass.
- Forged `X-User-Context` header is rejected by DA with 401.
- A stub MCP server records the inbound `Authorization` header from a DA-initiated tool call; assertion: header is present and JWT `sub` matches the chatting user.

**Maps to**: Story 6, FR-002, FR-003, FR-004, FR-005

---

### Phase 5 — Slack OBO + E2E + Doc Update (Stories 5 + 7 + 8)

**Files modified**:
- `ai_platform_engineering/integrations/slack_bot/app.py` — every command path uses `impersonate_user(keycloak_sub)` to mint the OBO
- `ai_platform_engineering/integrations/slack_bot/utils/rbac_middleware.py` — remove channel-allowlist gate (it becomes a Keycloak `slack#use` scope check)
- `docs/docs/security/rbac/{architecture,workflows,usage,file-map}.md` — full update per FR-014, including:
  - File map table in `file-map.md` (auto-validated by `scripts/validate-rbac-doc.py`)
  - Sequence diagrams for all post-migration flows in `workflows.md` (cross-reference `call-sequences.md`)
  - Component sections in `architecture.md` for all NEW Python helpers and the DA migration
  - Removed-features callouts: `requireAdmin`, `requireAdminView` (production), `X-User-Context` header trust, `SharedKeyMiddleware`, channel-allowlist
  - (The original `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md` is now a redirect stub.)
- `Makefile` — `test-rbac` target now real (was stub in Phase 0)

**Files added**:
- Playwright suite in `tests/rbac/e2e/` — 8 user journeys covering the 8 stories
- `scripts/validate-rbac-doc.py` (final form)

**Approach**:
1. Wire Slack OBO via `impersonate_user` (the helper exists at `slack_bot/utils/obo_exchange.py:89`).
2. Verify Keycloak's token-exchange + impersonation permissions are granted to `caipe-slack-bot` client in `realm-config.json` (Phase 0 enabled the feature flag; this phase wires the policies).
3. Build the Playwright suite incrementally, one user story per spec file under `tests/rbac/e2e/`.
4. Final pass: rewrite the four RBAC docs under `docs/docs/security/rbac/` end-to-end using the now-true post-migration code state. Run the doc validator. Run the 10-question quiz against a junior reviewer (SC-007).

**Acceptance**:
- All 8 user stories' Playwright suites pass against `docker-compose.dev.yaml` + `docker-compose/docker-compose.e2e.override.yaml` driven by `COMPOSE_PROFILES`.
- `make test-rbac` total time ≤ 10 minutes locally (SC-005, SC-008).
- `scripts/validate-rbac-doc.py` passes (file-map current).
- 10-question quiz passes 9/10 with a junior reviewer (SC-007).
- `docs/docs/security/rbac/` review checklist signed off by a security-architect-equivalent reviewer.

**Maps to**: Stories 5 + 7 + 8, FR-008, FR-009, FR-010, FR-011, FR-014

---

## Open Questions — Resolved

The four open questions in the spec are resolved as follows; rationale lives in [`research.md`](./research.md):

| Question | Resolution | Reference |
|---|---|---|
| 1. PDP-unavailable behaviour for non-admin scopes | **Configurable per-resource**, default deny-all. Rules live in `deploy/keycloak/realm-config-extras.json`. `admin_ui` preserves its existing `admin` realm-role fallback. | research.md §1, contracts/realm-config-extras.schema.json |
| 2. Test fixture location | **Single repo-root `tests/rbac/`**. Component runners load the matrix and personas from there. | research.md §2 |
| 3. Realm-config drift detection severity | **Hard gate**. CI fails if any `(resource, scope)` referenced in code is missing from `realm-config.json`. | research.md §3 |
| 4. Slack OBO token-exchange in dev compose | **Enable in `deploy/keycloak/docker-compose.yml`** so dev mirrors prod. Done in Phase 0. | research.md §4 |

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Keycloak token-exchange feature flag breaks unrelated dev workflows | Medium | Phase 0 verifies with a smoke test against the existing dev compose; if breakage occurs, isolate the feature behind a separate compose profile. |
| Phase 4 ContextVar wiring for DA misses an async boundary, OBO leaks across requests | High | Reuse the supervisor's exact pattern (verified working post-merge); add an explicit pytest that asserts `current_user_token.get()` returns `None` after a request completes. |
| Mongo `authz_decisions` collection grows unbounded | Low | Out-of-scope to add TTL index here; documented in `data-model.md` as a follow-up; recommend operators add `expireAfterSeconds` on `ts`. |
| `tests/rbac-matrix.yaml` becomes stale relative to actual code | Medium | `scripts/validate-rbac-matrix.py` is a hard CI gate (FR-010, SC-006); adding a route without an entry fails the build. |
| Playwright E2E flakiness from real Keycloak races | Medium | Phase 5 uses `await` on Keycloak `/health/ready` before each test; persona-token fixture caches tokens for the test session to avoid redundant token endpoint hits. |
| 10-min wall-time budget for `make test-rbac` is exceeded | Medium | Parameterise tests over matrix entries to amortise fixture setup; cache JWKS at test fixture level; run E2E with parallel workers (Playwright supports `--workers`). Budget includes 4-min headroom (SC-008). |
| ~25-file PR is large, increases review burden | Low (accepted) | The spec mandates single PR (FR-015); review is structured by phase via `call-sequences.md`. Reviewer playbook is documented in spec §"How to read these diagrams when reviewing the migration PR". |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Two TS↔Py mirrors of `requireRbacPermission` and `logAuthzDecision` introduced on first occurrence (vs Constitution Rule of Three) | The trust boundary is polyglot — UI BFF is Node/TypeScript, every service that handles JWTs server-side is Python. Without the Python mirrors, services fall back to ad-hoc auth that's exactly the gap this spec closes. | (a) Sharing logic via a sidecar (e.g., OPA) was rejected because Keycloak's PDP is already the policy engine; adding OPA would duplicate it. (b) Sharing via a thin HTTP service was rejected because every gate would add a network hop. (c) Generating Py from TS via codegen was rejected as YAGNI for two functions. The mirrors are mechanical and ~30 lines each. |
| New top-level `tests/rbac/` directory (vs colocating tests with each component) | Personas, the matrix, and the persona-token fixture are shared across Jest, pytest, and Playwright. A single source of truth eliminates drift. | Colocation was rejected because the matrix would need to live in three places (or one, with three loaders) and one of the spec's own goals is to make drift impossible. |

---

## Phase 1 Re-evaluation: Constitution Check

Re-checked after the design above is fleshed out (no new gates emerged in Phase 1 of the speckit flow):

| Principle | Status | Notes |
|---|---|---|
| I. Worse is Better | ✅ Pass (unchanged) | Phases are deliberately ordered to ship value early; each phase is independently shippable. |
| II. YAGNI | ✅ Pass (unchanged) | No speculative features; all NEW files trace to FRs. |
| III. Rule of Three | ⚠️ Justified deviation (unchanged) | TS↔Py mirrors documented in Complexity Tracking. |
| IV. Composition over Inheritance | ✅ Pass (unchanged) | All new modules expose functions/middleware classes consumed via composition. |
| V. Specs as Source of Truth | ✅ Pass (unchanged) | `tests/rbac-matrix.yaml` is the in-code embodiment of the spec's matrix. |
| VI. CI Gates Are Non-Negotiable | ✅ Pass (unchanged) | `make test-rbac` is the new CI signal; both validators are hard gates. |
| VII. Security by Default | ✅ Pass (unchanged) | Default-deny + audit-log + JWKS validation + OBO at every hop + explicit forgeable-header removal. |

**Result**: ✅ Constitution Check passes after Phase 1 design with one justified deviation (unchanged from initial check).

---

## What this command did NOT produce

This is a `/speckit.plan` output. It deliberately stops short of:

- **`tasks.md`** — produced by the next command, `/speckit.tasks`. That command will break each phase above into individually-trackable tasks (one per route migration, one per MCP server, one per test file, etc.).
- **Code changes** — no source files have been modified by this plan command. All edits begin in the implementation phase, after `/speckit.tasks` is approved.
- **`docs/docs/security/rbac/` updates** — explicitly deferred to Phase 5 per spec §"Pending Tasks".
