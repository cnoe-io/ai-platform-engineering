# Phase 0 Research: Comprehensive RBAC Tests + Completion of 098

**Date**: 2026-04-22
**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md)

This document resolves the four open questions in `spec.md` §"Open questions (for the user, before plan)" and records the supporting decisions for technologies and patterns picked in the plan. Each resolution lists the chosen option, rationale, and alternatives considered (per the speckit research convention).

---

## §1 — PDP-unavailable behaviour for non-admin scopes

### Decision
**Configurable per-resource, default deny-all.** Per-resource overrides live in `deploy/keycloak/realm-config-extras.json` (a sibling file consumed by both the TypeScript and Python middlewares). The `admin_ui` resource preserves its existing `admin` realm-role fallback. Resources without an entry in `realm-config-extras.json` deny all requests when Keycloak's PDP is unreachable (HTTP 503 with `reason=DENY_PDP_UNAVAILABLE`).

### Rationale
- Matches the existing TS implementation (`ui/src/lib/api-middleware.ts:RESOURCE_ROLE_FALLBACK`) which already has the `admin_ui → admin` mapping. Keeping that as data in JSON instead of code lets ops adjust without a code deploy.
- Default deny-all is the conservative posture — security-by-default per Constitution VII.
- A single JSON sidecar file is the simplest implementation that satisfies both runtimes (TS + Py); the alternative (encoding the rules in Keycloak itself as a custom policy) was rejected as YAGNI.

### Alternatives considered
| Option | Why rejected |
|---|---|
| (a) Deny-all for everything (no per-resource override) | Removes the existing `admin_ui` escape hatch, which is in production today and explicitly preserved by Story 1 acceptance scenario 3. |
| (b) Realm-role fallback per resource, hard-coded in TS+Py middleware | Drift risk between the two languages and zero ops flexibility. Adds two places to update for every new resource. |
| (c) Configurable per-resource via Mongo collection | Over-engineered for what is fundamentally configuration. JSON file beside the realm-config is the natural neighbour. |
| (d) Configurable via Keycloak custom policy script | Adds a Keycloak-server-side script dependency. Operationally riskier (Keycloak script policies need server-side allowlisting). |

### Schema
Documented in [`contracts/realm-config-extras.schema.json`](./contracts/realm-config-extras.schema.json).

```json
{
  "version": 1,
  "pdp_unavailable_fallback": {
    "admin_ui": {
      "mode": "realm_role",
      "role": "admin"
    },
    "rag": {
      "mode": "deny_all"
    }
  }
}
```

---

## §2 — Where do the test fixtures live?

### Decision
**Single repo-root `tests/rbac/`** for the matrix, persona fixtures, and audit assertion helpers. Each component's existing test runner (Jest in `ui/src/app/api/__tests__/`, pytest in `tests/`, Playwright in a new `tests/rbac/e2e/`) loads from this directory via thin shims.

```text
tests/rbac/
├── rbac-matrix.yaml
├── conftest.py                 # pytest fixture entrypoint
├── fixtures/
│   ├── keycloak.py             # mints persona tokens via real Keycloak
│   ├── keycloak.ts             # mirror — used by Jest + Playwright
│   ├── audit.py
│   └── audit.ts
├── unit/
│   ├── ts/                     # Jest tests parameterised over the matrix
│   └── py/                     # pytest tests parameterised over the matrix
└── e2e/                        # Playwright (8 user journeys)
```

### Rationale
- The matrix is a single source of truth. Splitting it across components creates exactly the kind of drift this spec exists to eliminate.
- Persona-token logic must be identical in TS and Py — colocating them makes their parity visually obvious.
- Component-local tests can stay; they just import from `tests/rbac/fixtures/`.

### Alternatives considered
| Option | Why rejected |
|---|---|
| Colocate matrix with each component (`ui/tests/rbac/`, `ai_platform_engineering/tests/rbac/`) | Three copies of the matrix → guaranteed drift; defeats FR-010. |
| Single colocated runner under `ui/` (Playwright already lives there partially) | Forces Python tests to either move or reach across `ai_platform_engineering/`/`ui/` boundary. The `tests/` folder at repo root already exists for cross-cutting concerns. |
| Separate repo for tests | Out-of-scope and would defeat the "single PR" mandate (FR-015). |

---

## §3 — Realm-config drift detection severity

### Decision
**Hard gate.** `scripts/validate-rbac-matrix.py` and `scripts/validate-realm-config.py` exit non-zero on any drift, and `make test-rbac` (which CI runs) calls them.

### Rationale
- Spec author's recommendation, accepted on first read.
- Realm-config drift is a class of bug that silently grants or denies access. Soft warnings get ignored. Hard gates do not.
- Cost is bounded: each script runs in <1s.

### Alternatives considered
| Option | Why rejected |
|---|---|
| Advisory warning | Silent failures in production are exactly what the spec wants to prevent. |
| Manual review only | Adding 1 entry per route is too easy to forget; humans are not the right last line. |
| Defer to Keycloak's own policy validation | Keycloak validates that the policy syntax is right but not that the code references resources/scopes that exist. Drift is between code and config, not within config. |

---

## §4 — Slack OBO token-exchange enabled by default in dev compose?

### Decision
**Yes, enabled by default** in `deploy/keycloak/docker-compose.yml` via `--features=token-exchange,admin-fine-grained-authz` (the comma-list adds the existing fine-grained-authz feature alongside, as both are required by the broader RBAC stack).

### Rationale
- Dev MUST mirror prod, otherwise Slack OBO bugs only surface in CI/staging — exactly the class of bug 098 was supposed to eliminate.
- The Keycloak feature flag is supported in the Quay distribution already used by the dev compose; no image change required.
- Phase 0 includes a smoke test verifying the existing dev workflows still boot (`docker compose up keycloak` reaches healthy state).

### Alternatives considered
| Option | Why rejected |
|---|---|
| Enable only via the e2e overlay (`docker-compose/docker-compose.e2e.override.yaml`) | Splits dev and test environments — bugs that only show up under token-exchange would never be seen during dev. |
| Document as opt-in via `KC_FEATURES` env var | One more thing to forget; the spec's own Story 5 acceptance scenarios depend on token-exchange being available. |
| Use the Keycloak Admin API to enable post-startup | Adds a startup race; needs an init container or a sidecar; over-engineered for a feature flag. |

---

## Supporting Technology Decisions

The following decisions are not "open questions" in the spec but are explicit choices the plan makes that deserve a record.

### TD-1 — Test framework: Playwright for E2E
**Decision**: Playwright for the 8 end-to-end user journeys (Story 7 + 8 acceptance).
**Rationale**: Repo already has Playwright in `ui/` for non-RBAC E2E. Adding RBAC suites under `tests/rbac/e2e/` keeps the dependency footprint stable. Playwright handles the cookie-based BFF flow (NextAuth session) plus header-based bearer flows out of the box.
**Alternatives**: Cypress (smaller existing footprint), pytest-playwright (mixes layers), raw curl scripts (no browser flow). All rejected for spinning up new tooling or losing coverage.

### TD-2 — Python JWKS validation library
**Decision**: `python-jose` (already a dependency via supervisor's existing flows). Wrapper at `ai_platform_engineering/utils/auth/jwks_validate.py`.
**Rationale**: No new dependency. `PyJWT` was considered but `jose` already handles JWKS rotation in the existing supervisor middleware.
**Alternatives**: `PyJWT` + `httpx` (adds parsing logic we don't need); `authlib` (heavyweight).

### TD-3 — Python audit-log emit
**Decision**: Python `log_authz_decision()` writes to Mongo `authz_decisions` directly (no message queue). Mirrors TS pattern.
**Rationale**: Existing TS code writes Mongo direct, no queue in the stack today. Adding a queue is YAGNI. Write failures are logged-and-swallowed per FR-007.
**Alternatives**: OpenTelemetry events (out-of-scope); message queue (not in stack).

### TD-4 — Python PDP cache
**Decision**: Process-local in-memory cache mirroring the TS `permissionDecisionCache`. Implementation: `cachetools.TTLCache(maxsize=10000, ttl=int(os.getenv('RBAC_CACHE_TTL_SECONDS', 60)))`. Same env var as TS.
**Rationale**: Same TTL semantics across both languages. Process-local cache mirrors the TS implementation; both languages eat the same cache-miss cost on cold start. Sharing a Redis cache across processes is YAGNI for the current scale and would add a new dependency to every Python service.
**Alternatives**: Redis-backed cache (over-engineered), no cache (PDP storm risk), per-request cache only (loses repeat benefit).

### TD-5 — DA `MultiServerMCPClient` token forwarding mechanism
**Decision**: ContextVar-backed `httpx_client_factory` mirroring the supervisor's exact pattern (`ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py:_build_httpx_client_factory`).
**Rationale**: Supervisor's pattern is verified working post-merge; reusing it eliminates an entire class of "did we get the async boundary right?" bugs. Risk register acknowledges the residual risk and adds an explicit pytest check.
**Alternatives**: Pass token explicitly through every call layer (massive blast radius), use thread-local instead of ContextVar (broken under asyncio), middleware injection at MCP server (wrong layer).

### TD-6 — `tests/rbac-matrix.yaml` schema
**Decision**: Flat list of route entries with `(route, method, resource, scope, persona, expected_status)` columns.
**Rationale**: Trivial to read, trivial to validate, trivial to parameterise tests against.
**Alternatives**: Nested by component (harder to validate completeness), JSON instead of YAML (existing convention is YAML for human-edited config).
Schema in [`contracts/rbac-matrix.schema.json`](./contracts/rbac-matrix.schema.json).

### TD-7 — `authz_decisions` collection schema
**Decision**: One document per decision; keys `{userId, resource, scope, allowed, reason, source, ts}` (where `source ∈ {'ts', 'py'}`). No TTL index in this PR (operational concern, called out in plan Risk Register).
**Rationale**: Mirrors existing TS audit log shape. Reason codes drawn from a fixed enum to enable dashboards.
**Alternatives**: Bigger document (adds payload, not value at this scope); structured logs only (loses queryability).
Schema in [`contracts/audit-event.schema.json`](./contracts/audit-event.schema.json).

### TD-8 — Single-PR vs multi-PR
**Decision**: Single PR (FR-015), already approved by user via `single_pr_speckit` choice.
**Rationale**: User-mandated, codified in the spec, embodied in the existing `prebuild/feat/comprehensive-rbac` branch.
**Alternatives**: One PR per phase (rejected by user during brainstorming).

---

## Open follow-ups (NOT for this PR)

These surfaced during research and are recorded so future work can pick them up cleanly. None block this spec.

1. **`authz_decisions` retention.** Recommend operators add `expireAfterSeconds` index on `ts` (90-180 days). Out of scope here per the plan Risk Register.
2. **Cross-process PDP cache.** If steady-state PDP load grows, consider a Redis-backed cache. Currently process-local is sufficient; no benchmark indicates otherwise.
3. **Keycloak realm export to repo (drift in the other direction).** `realm-config.json` is the input; production realm state could drift from it. A nightly export-and-diff job is a worthwhile follow-up but out of scope.
4. **Per-tool MCP scopes (finer than `read`/`write`).** Some MCP tools have order-of-magnitude different blast radius (e.g., `argocd.delete_app` vs `argocd.list_apps`). The current spec uses two scopes per MCP for simplicity; per-tool scopes are a reasonable Phase 6.
