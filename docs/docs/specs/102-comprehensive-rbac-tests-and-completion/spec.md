# Feature Specification: Comprehensive RBAC Tests + Completion of 098

**Feature Branch**: `prebuild/feat/comprehensive-rbac` (existing)
**Created**: 2026-04-22
**Status**: Draft — awaiting user review
**Input**: User description: "We need a super comprehensive rules based unit and e2e tests for RBAC for each area and update how RBAC works diagrams based on the updates we made"

**Companion docs**:
- [`call-sequences.md`](./call-sequences.md) — code-level sequence diagrams (real `file:function` references, before/after migration) for every flow this spec touches.

## Why this spec exists

Spec [098-enterprise-rbac-slack-ui](../098-enterprise-rbac-slack-ui/spec.md) defined the target end state: every CAIPE surface — UI BFF, supervisor, agents, MCP, RAG, Slack, dynamic agents, A2A — gates on Keycloak Authorization Services with default-deny, OBO token forwarding, and CEL where appropriate.

Today (2026-04-22), the implementation is partial:

| Surface | 098 target | Reality on `prebuild/feat/comprehensive-rbac` |
|---|---|---|
| UI BFF — admin pages | `requireRbacPermission(session, 'admin_ui', 'view')` | `/admin/users` and `/admin/users/stats` migrated; ~15 other admin/management routes still on legacy `requireAdmin(session)` |
| Supervisor | JwtUserContextMiddleware + JWKS + OBO + httpx_client_factory | Implemented after PR #1253 + #1145 merges; **untested as a unit** |
| Agent MCP | All MCP servers honour JWT and gate on `requireRbacPermission` | Mix of shared key, OAuth2, dual-auth; **no Keycloak gate** in any MCP server |
| RAG (KB ingest/retrieve) | `rag#ingest` / `rag#retrieve` Keycloak gates + Mongo KB ACL (per FR-026, FR-027) | Group-claim checks only; **no Keycloak resource defined** |
| Slack bot | `slack#use` scope + per-user OBO via `slack_user_id` linkage | Channel-allowlist + group claims only |
| Dynamic / custom agents | `dynamic_agent#view` / `#invoke` / `#manage` + JWT validation + per-request token forwarding to MCP (per FR-028, FR-030) | DA backend trusts forgeable `X-User-Context` header; chat endpoint has **no per-agent authz**; MCP tool calls carry **no user bearer** |
| A2A | OBO across agent hops (per FR-018) | `forward_jwt_to_mcp` flag exists; no integration tests prove the chain |

Without comprehensive tests this gap is invisible to reviewers and easy to regress. Without the missing migrations, the tests have nothing to assert against. This spec closes both at once.

## Clarifications

### Session 2026-04-22

- Q: How should the e2e test stack be brought up — a new `docker-compose/docker-compose.e2e.yaml`, or reuse `docker-compose.dev.yaml` with `COMPOSE_PROFILES`? → A: Reuse `docker-compose.dev.yaml` with a curated `COMPOSE_PROFILES` selection (no second compose file). Test-only port remaps and env-var overrides go in a tiny `docker-compose/docker-compose.e2e.override.yaml` overlay only if strictly required (e.g., to avoid host-port collisions with a running dev stack). The `make test-rbac` target sets `COMPOSE_PROFILES="rbac,caipe-ui,caipe-supervisor,caipe-mongodb,dynamic-agents,rag,all-agents,slack-bot"` and runs `docker compose -f docker-compose.dev.yaml [-f docker-compose/docker-compose.e2e.override.yaml] up -d --wait`.

## In scope

1. Migrate every authorization decision point to Keycloak Authorization Services, replacing legacy gates (`requireAdmin`, `canViewAdmin`, raw group-claim checks, channel-allowlists, `X-User-Context` header trust).
2. Define and seed the missing Keycloak resources, scopes, and policies in `deploy/keycloak/realm-config.json`.
3. Add a uniform RBAC middleware to every Python service (supervisor, dynamic agents backend, RAG server, agent MCP servers, Slack bot) that validates the bearer against JWKS and calls Keycloak's PDP with `urn:ietf:params:oauth:grant-type:uma-ticket`.
4. Wire per-request user-token forwarding into every MCP client used by an agent (supervisor’s `httpx_client_factory` exists; the dynamic-agents `MultiServerMCPClient` does not).
5. Add a comprehensive automated test matrix:
   - Jest unit tests for every BFF route × every persona × allow/deny permutation.
   - pytest unit tests for every Python middleware × every persona × allow/deny permutation.
   - Playwright end-to-end tests against a real Keycloak (docker-compose) covering the canonical user journeys.
6. Add audit logging at every new gate using the existing `logAuthzDecision` (TS) / equivalent Python helper.
7. Update `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md` so its diagrams, file map, and component sections reflect the post-migration reality.

## Out of scope (explicitly)

- Replacing NextAuth with another auth library.
- Replacing MongoDB as the team / KB-ownership store.
- Replacing the existing CEL evaluator implementations (`ui/src/lib/rbac/cel-evaluator.ts`, `ai_platform_engineering/dynamic_agents/src/dynamic_agents/cel_evaluator.py`).
- Designing a new Admin UI layout. Admin UI changes are limited to wiring forms to the new Keycloak APIs and documenting the migration in `how-rbac-works.md`.
- Performance benchmarking. The PDP cache TTL (`RBAC_CACHE_TTL_SECONDS`, default 60s) is taken as given.
- Multi-realm or multi-Keycloak federation. Single realm only.

## Personas (used throughout the user stories below)

| Persona | Keycloak realm roles | Team membership (Mongo) | Slack link |
|---|---|---|---|
| `alice_admin` | `admin` | `platform-admins` | linked |
| `bob_chat_user` | `chat_user`, `team_member` | `team-a` | linked |
| `carol_kb_ingestor` | `chat_user`, `kb_ingestor` (per-KB role: `kb_ingestor:team-a-docs`) | `team-a` | linked |
| `dave_no_role` | (none) | (none) | unlinked |
| `eve_dynamic_agent_user` | `chat_user`, `agent_user:my-team-agent` | `team-a` | linked |
| `frank_service_account` | client-credentials, `service_account` realm role | n/a | n/a |

These personas are defined as `kcadm` create-script fragments in the test fixture and reused across Jest, pytest, and Playwright.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Admin UI is fully Keycloak-gated (Priority: P1)

`alice_admin` can reach every page under `/admin/*` and every BFF route under `/api/admin/*`. Anyone else gets a 403.

**Why this priority**: This is the most-used RBAC surface, the area the existing test suite exercises best, and the lowest-risk migration (the pattern is already proven by `/api/admin/users/stats`).

**Independent Test**: Boot Keycloak + UI, log in as each persona, hit every `/api/admin/*` route, assert 200 for `alice_admin` and 403 for everyone else. Uses real Keycloak Authorization Services PDP.

**Acceptance Scenarios**:

1. **Given** `alice_admin` is logged in, **When** she GETs `/api/admin/users`, **Then** she receives 200 and the response is sourced from Keycloak Admin API.
2. **Given** `bob_chat_user` is logged in, **When** he GETs `/api/admin/users`, **Then** he receives 403 with `reason=DENY_NO_CAPABILITY`.
3. **Given** Keycloak's PDP is unreachable AND `admin_ui` has a realm-role fallback configured to `admin`, **When** `alice_admin` (who has the `admin` realm role) GETs `/api/admin/users`, **Then** she receives 200 via the role-fallback. Configuration lives in `deploy/keycloak/realm-config-extras.json`.
4. **Given** Keycloak's PDP is unreachable AND `admin_ui` has a realm-role fallback configured, **When** `bob_chat_user` GETs `/api/admin/users`, **Then** he receives 403 (he lacks the fallback role).
5. **Given** Keycloak's PDP is unreachable AND a resource has NO fallback configured (default), **When** any persona GETs the gated route, **Then** the response is 503 with `reason=DENY_PDP_UNAVAILABLE` (deny-all).
6. **Given** any caller, **When** the gate fires, **Then** an entry appears in the `authz_decisions` Mongo collection with `{userId, resource: 'admin_ui', scope: 'view', allowed, reason, timestamp}`.

---

### User Story 2 — Supervisor enforces Keycloak before delegating to agents (Priority: P1)

When the supervisor receives an A2A request, it validates the bearer against Keycloak's JWKS, extracts the user context, and passes the user's OBO token (not the bot's service account) to every downstream agent and MCP call.

**Why this priority**: The supervisor is the trust boundary for every backend interaction. If it doesn't enforce, every downstream check is moot.

**Independent Test**: Send an A2A request with (a) a valid `bob_chat_user` token, (b) an expired token, (c) a token signed by a different issuer, (d) no token. Assert 200, 401, 401, 401 respectively. With (a), assert that the OBO token landed in the downstream MCP `Authorization` header (verified via a stub MCP server that records headers).

**Acceptance Scenarios**:

1. **Given** a valid bearer for `bob_chat_user`, **When** the supervisor receives an A2A `tasks/send` for `argocd_agent.list_apps`, **Then** the request is authorized, an OBO token is minted (`urn:ietf:params:oauth:grant-type:token-exchange`), and the downstream MCP call sees `Authorization: Bearer <obo_token>` whose `act.sub` claim is the supervisor service account.
2. **Given** an expired bearer, **When** the supervisor receives any A2A request, **Then** it responds `401 invalid_token` and never opens a graph stream.
3. **Given** a bearer signed by an issuer other than the configured Keycloak realm, **When** the supervisor receives any A2A request, **Then** it responds `401 invalid_token` and never queries JWKS for it twice in one minute.
4. **Given** a chain of two agents (supervisor → agent A → agent B), **When** `bob_chat_user` invokes the chain, **Then** every hop sees a token whose `sub` resolves to `bob_chat_user`'s `keycloak_sub` and whose `act` chain reflects the calling service.

---

### User Story 3 — Every agent MCP server is Keycloak-gated (Priority: P1)

Every MCP server (`argocd`, `aws`, `jira`, `github`, `pagerduty`, `splunk`, `confluence`, `webex`, `slack`, `komodor`, `aigateway`, `backstage`) accepts only requests with a valid Keycloak-issued bearer and only invokes a tool if the caller has the matching `<agent>_mcp#<scope>` permission.

**Why this priority**: MCP is where agent capability ultimately materializes. Today most MCPs trust shared keys or have no auth — that's the largest live attack surface.

**Independent Test**: For each MCP server, run a parameterized pytest that POSTs `tools/list` and a representative `tools/call` with each persona's token. Assert the matrix: `chat_user` can list+read, `team_member` can list+read+write within team scope, `admin` can do everything, `dave_no_role` gets 401.

**Acceptance Scenarios**:

1. **Given** `bob_chat_user` with `argocd_mcp:read`, **When** he calls `argocd.list_apps`, **Then** the MCP returns 200.
2. **Given** `bob_chat_user` without `argocd_mcp:write`, **When** he calls `argocd.delete_app`, **Then** the MCP returns 403 from `requireRbacPermission(...)` and never reaches the tool implementation.
3. **Given** any MCP server with no Authorization header, **When** any tool call is made, **Then** the MCP returns 401.
4. **Given** the legacy `SHARED_KEY` env var is still set, **When** a request arrives with that key but no bearer, **Then** the MCP returns 401 and logs a deprecation warning. (Shared-key auth is removed in this spec.)
5. **Given** any tool call, **When** the MCP forwards to the upstream system (ArgoCD API, Jira API, etc.), **Then** the upstream sees the user's identity in audit logs (header forwarding, where supported).

---

### User Story 4 — RAG enforces hybrid Keycloak + Mongo KB ACL (Priority: P1)

Per spec 098 FR-026 and FR-027, the RAG server gates `/v1/ingest` and `/v1/query` on Keycloak (`rag#ingest`, `rag#retrieve`), then filters per-KB based on Mongo `TeamKbOwnership` and per-KB Keycloak roles (`kb_reader:<id>`, `kb_ingestor:<id>`).

**Why this priority**: KB content frequently contains sensitive operational data (tickets, runbooks, incident postmortems). Today RAG retrieval is gated only on group claims with no Keycloak PDP involvement — a gap explicitly called out in 098.

**Independent Test**: Seed two KBs (`team-a-docs`, `team-b-docs`) with distinct sentinel documents. Run `/v1/query` as each persona. Assert: `alice_admin` sees both, `carol_kb_ingestor` (team-a) sees only `team-a-docs`, `bob_chat_user` sees neither in a strict deployment, both in a permissive deployment (depending on `rag_default_visibility`).

**Acceptance Scenarios**:

1. **Given** `carol_kb_ingestor` with `kb_ingestor:team-a-docs`, **When** she POSTs to `/v1/ingest` with a document tagged `kb_id=team-a-docs`, **Then** the document is ingested.
2. **Given** the same persona, **When** she POSTs to `/v1/ingest` with `kb_id=team-b-docs`, **Then** the RAG server returns 403.
3. **Given** `bob_chat_user` (member of `team-a` in Mongo), **When** he POSTs to `/v1/query`, **Then** results include only documents whose `kb_id` is owned by `team-a` per `TeamKbOwnership`.
4. **Given** `dave_no_role`, **When** he POSTs to `/v1/query`, **Then** he receives 403.
5. **Given** any successful query, **When** the result set is built, **Then** filtering happens server-side in the RAG service, not at the BFF.

---

### User Story 5 — Slack commands run with the user's identity, not the bot's (Priority: P2)

When a linked Slack user issues a command, the bot exchanges its app token + the user's `slack_user_id` linkage for a Keycloak OBO token, calls the supervisor with that token, and the entire downstream chain (agents, MCPs, RAG) sees the user's identity.

**Why this priority**: Without this, every Slack action looks like the bot to backend audit logs, defeating both attribution and per-user authorization.

**Independent Test**: Send a slash command from a linked user via the Slack Events test harness, capture the supervisor's incoming Authorization header, decode the JWT, assert `sub == bob_chat_user.keycloak_sub` and `act.sub == slack-bot`'s service account.

**Acceptance Scenarios**:

1. **Given** a linked Slack user (`bob_chat_user`), **When** he runs `/caipe list argocd apps`, **Then** the supervisor sees a token with `sub=bob_chat_user.keycloak_sub`.
2. **Given** an unlinked Slack user, **When** he runs any command, **Then** the bot replies with the linking instructions (FR-025) and does not call the supervisor.
3. **Given** a linked user lacking `argocd_mcp:read`, **When** he runs `/caipe list argocd apps`, **Then** the supervisor delegates to ArgoCD MCP, ArgoCD MCP returns 403, the bot surfaces a user-friendly message, and audit logs the denial.
4. **Given** a channel mapped to `team-b` and a user lacking `team_member` for `team-b`, **When** he runs any command, **Then** the bot denies per FR-031 with a clear message.
5. **Given** the bot's own startup, **When** it registers with the supervisor, **Then** it uses its **service account** token (not a user OBO), and the supervisor allows only the narrow scope `slack#register`.

---

### User Story 6 — Custom (dynamic) agents are bound to Keycloak (Priority: P1)

Every dynamic agent becomes a Keycloak resource with `view`, `invoke`, `manage` scopes (per 098 FR-028). The DA backend validates JWT bearers (no more `X-User-Context` trust). The chat endpoint enforces `requireRbacPermission(session, 'dynamic_agent:<agent_id>', 'invoke')`. MCP tool calls from a DA runtime carry the user's per-request OBO bearer (not a runtime-cached one).

**Why this priority**: The earlier audit found this is the single largest gap — anyone authenticated can chat with any custom agent today, MCP tools called by custom agents go out anonymously, and a forged `X-User-Context` header gives admin-level access if DA is reachable directly. This story closes all five layers in one go.

**Independent Test**: Three agents seeded — `private-eve`, `team-a-shared`, `global-public`. Each persona attempts `view`, `invoke`, `manage` on each. Result matrix asserted via Playwright (BFF) and pytest (DA backend talked to directly with an injected forged header — proves the header is no longer trusted).

**Acceptance Scenarios**:

1. **Given** `eve_dynamic_agent_user` with `agent_user:my-team-agent`, **When** she POSTs to `/api/v1/chat/stream/start` with `agent_id=my-team-agent`, **Then** the BFF passes the gate and DA streams a response.
2. **Given** `bob_chat_user` without per-agent role, **When** he POSTs the same with `agent_id=eve-private`, **Then** the BFF returns 403 and never opens a stream to DA.
3. **Given** the DA backend is reached directly (bypassing the BFF) with a forged `X-User-Context` header claiming `is_admin=true`, **When** any endpoint is hit, **Then** the response is 401 because the header is no longer trusted; only `Authorization: Bearer <jwt>` is honoured.
4. **Given** a custom agent's runtime calls an MCP tool, **When** the MCP receives the request, **Then** the `Authorization` header carries a fresh per-request OBO token whose `sub` is the chatting user, not a stale token from an earlier conversation turn.
5. **Given** any DA authorization decision (allow or deny), **When** it occurs, **Then** an entry appears in the `authz_decisions` Mongo collection.

---

### User Story 7 — Comprehensive automated test matrix exists and runs in CI (Priority: P1)

There is one pass/fail signal per RBAC area, runnable locally and in CI. Adding a new endpoint without a corresponding test entry causes the suite to fail.

**Why this priority**: Tests are the only mechanism that prevents the gaps we just closed from re-opening.

**Independent Test**: `make test-rbac` runs all three layers (Jest, pytest, Playwright) and exits non-zero if any persona-permutation fails. New routes without entries in `tests/rbac-matrix.yaml` fail the linter.

**Acceptance Scenarios**:

1. **Given** the post-migration codebase, **When** `make test-rbac` runs, **Then** Jest BFF, pytest backend, and Playwright E2E suites all pass with **zero skipped RBAC tests**.
2. **Given** a developer adds a new BFF route under `/api/admin/*` without a `requireRbacPermission` call, **When** they run `make test-rbac`, **Then** the suite fails with a specific message identifying the unprotected route.
3. **Given** a developer adds a new MCP tool without a corresponding scope in `deploy/keycloak/realm-config.json`, **When** they run `make test-rbac`, **Then** the suite fails with a specific message identifying the missing scope.
4. **Given** the test fixtures, **When** the Playwright suite starts, **Then** it brings up Keycloak, Mongo, UI, supervisor, DA, RAG, and at least one agent MCP by running `docker compose -f docker-compose.dev.yaml [-f docker-compose/docker-compose.e2e.override.yaml] up -d --wait` with `COMPOSE_PROFILES="rbac,caipe-ui,caipe-supervisor,caipe-mongodb,dynamic-agents,rag,all-agents,slack-bot"` (no separate `docker-compose.e2e.yaml`).
5. **Given** a green CI run, **When** the audit logs are inspected, **Then** every persona-route pair from `tests/rbac-matrix.yaml` produced a corresponding `authz_decisions` entry.

---

### User Story 8 — `how-rbac-works.md` is the canonical, accurate reference (Priority: P2)

After the migration, `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md` accurately describes every component, every gate, every flow, and every file involved. A junior engineer who reads it can locate the code that enforces any given decision in under 5 minutes.

**Why this priority**: The earlier session-summary already noted the docs are out-of-sync; this is the user-facing manifestation of the migration.

**Independent Test**: A reviewer reads `how-rbac-works.md` end-to-end and answers a 10-question quiz (e.g., "Where is the dynamic-agent invoke gate enforced?", "Which env var controls the PDP cache TTL?", "What does `RESOURCE_ROLE_FALLBACK` do when Keycloak is unreachable?"). 9/10 correct = pass.

**Acceptance Scenarios**:

1. **Given** the post-migration code, **When** the file map at the bottom of `how-rbac-works.md` is checked, **Then** every authz-relevant file is listed with its current path.
2. **Given** the new components (DA backend JWT middleware, RAG hybrid gate, etc.), **When** the document is read, **Then** each one has a dedicated section with: purpose, env vars, error responses, file paths.
3. **Given** the post-migration sequence diagram, **When** read end-to-end, **Then** it shows: browser → BFF (PDP check) → supervisor (JWT validation + OBO mint) → agent (PDP check) → MCP (PDP check) → upstream system, with the audit log written at each gate.
4. **Given** the migration changes the meaning of any env var or removes any legacy gate, **When** the doc is read, **Then** the change is called out in a "Migrated from 098 partial implementation" callout.

---

### Edge Cases

- **PDP unavailable** — gate behaviour depends on per-resource configuration (see Open Question 1). Default for unconfigured resources is **deny-all**. `admin_ui` is configured to fall back to the `admin` realm role today; that configuration is preserved. Per-resource fallback rules live in `deploy/keycloak/realm-config-extras.json` (a sibling file consumed by both TS and Py middlewares).
- **Token expiring mid-request** — the supervisor's `httpx_client_factory` re-mints OBO if expiry is within 30s of the call.
- **Slack user link revoked mid-session** — next command returns the linking instructions; in-flight A2A streams complete (no mid-stream revocation).
- **Keycloak resource missing** — `requireRbacPermission` returns 503 (not 403) with a clear server log line; tests assert this distinction.
- **Per-user OIDC group claim larger than 16 KB** — bearer is rejected at the JWKS validation layer (header size check); tests cover this.
- **DA runtime cache holding a stale OBO token** — the new per-request `httpx_client_factory` for DA's `MultiServerMCPClient` resolves the bearer per-request via `ContextVar`; cached runtimes never carry tokens.
- **Two services calling Keycloak's PDP for the same `(token, resource, scope)` simultaneously** — both share the same `permissionDecisionCache` row keyed by `sha256(token):resource#scope`; both succeed or both fail; no PDP storm.
- **Audit log Mongo write fails** — the gate decision still proceeds (don't deny on audit-log failure); a structured warning is emitted with `{decision, error}`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every BFF route under `/api/admin/*`, `/api/dynamic-agents/*`, `/api/mcp-servers/*`, `/api/teams/*`, `/api/agents/*` MUST gate on `requireRbacPermission(session, '<resource>', '<scope>')`. The full route → `(resource, scope)` mapping MUST live in a single source-of-truth file (`tests/rbac-matrix.yaml`).
- **FR-002**: Every Python service (supervisor, dynamic_agents backend, RAG server, every agent MCP server, slack bot) MUST validate the bearer against Keycloak's JWKS endpoint with caching (TTL ≥ 5 min) and reject expired or wrong-issuer tokens with HTTP 401.
- **FR-003**: Every Python service MUST expose a `requireRbacPermission(token, resource, scope)` helper that calls Keycloak's PDP via `urn:ietf:params:oauth:grant-type:uma-ticket` with `response_mode=decision`, with the same caching semantics as the TS implementation.
- **FR-004**: The `X-User-Context` header consumed by `dynamic_agents/auth/auth.py` MUST be removed in favour of `Authorization: Bearer <jwt>`.
- **FR-005**: `MultiServerMCPClient` calls from the dynamic-agents runtime MUST source their `Authorization` header from a per-request `ContextVar`-backed factory (parallel to the supervisor's `httpx_client_factory`), never from a runtime-instance attribute.
- **FR-006**: `deploy/keycloak/realm-config.json` MUST seed the following resources and scopes; the file MUST be CI-validated against the post-migration code (every `requireRbacPermission` call's `(resource, scope)` MUST exist in the realm config):
  - `admin_ui` — `view`, `manage`
  - `dynamic_agent` — `view`, `invoke`, `manage`
  - `mcp_server` — `read`, `manage`
  - `team` — `view`, `manage`
  - `rag` — `ingest`, `retrieve`, `manage`
  - One resource per agent MCP (e.g. `argocd_mcp`, `aws_mcp`, `jira_mcp`, `github_mcp`, `pagerduty_mcp`, `splunk_mcp`, `confluence_mcp`, `webex_mcp`, `slack_mcp`, `komodor_mcp`, `aigateway_mcp`, `backstage_mcp`) each with scopes `read`, `write`
  - `slack` — `use`, `register`
- **FR-007**: Every gate (TS or Py) MUST emit an audit-log entry to Mongo collection `authz_decisions` with schema `{userId, resource, scope, allowed, reason, source, timestamp}`. Audit-log write failure MUST NOT cause the gate to fail open.
- **FR-008**: A reusable test fixture MUST stand up a real Keycloak (using `deploy/keycloak/docker-compose.yml`), seed the personas listed in this spec, and expose a TypeScript helper (`tests/fixtures/keycloak.ts`) and a pytest fixture (`tests/conftest.py::keycloak`) that returns a bearer for any persona by name.
- **FR-009**: A new `make test-rbac` target MUST exist that runs Jest, pytest, and Playwright RBAC suites in sequence and exits non-zero if any sub-suite fails.
- **FR-010**: A new `tests/rbac-matrix.yaml` MUST list every (route, resource, scope, persona, expected_status) tuple. A linter (`scripts/validate-rbac-matrix.py`) MUST verify that every BFF route under the protected prefixes appears in the matrix.
- **FR-011**: Slack bot MUST mint per-command OBO tokens via Keycloak token-exchange (`urn:ietf:params:oauth:grant-type:token-exchange`) using the linked `slack_user_id ↔ keycloak_sub` mapping from FR-025 of 098, and use them as the `Authorization` header for every supervisor call.
- **FR-012**: Every MCP server MUST replace `SharedKeyMiddleware`-based auth with `JwtUserContextMiddleware` + `requireRbacPermission`. The shared-key path MUST be removed (not deprecated-with-warning) in this PR.
- **FR-013**: The RAG server MUST implement hybrid authorization: Keycloak `rag#ingest` / `rag#retrieve` as the coarse gate, then per-KB filtering via the union of `TeamKbOwnership` (Mongo) and per-KB realm roles (`kb_reader:<id>`, `kb_ingestor:<id>`).
- **FR-014**: `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md` MUST be updated in the same PR to reflect every change: components, env vars, sequence diagrams, file map. The doc's "File Map" table MUST be auto-validated by `scripts/validate-rbac-doc.py` against the actual files referenced from the protected routes.
- **FR-015**: All migrations and tests MUST land on the existing `prebuild/feat/comprehensive-rbac` branch (PR #1257). No new branches.

### Key Entities

- **`authz_decisions` (Mongo collection)** — append-only audit log of every authorization decision. One document per decision. Indexed on `(userId, timestamp)` and `(resource, scope, timestamp)`.
- **`tests/rbac-matrix.yaml`** — single source of truth for which persona may do what. Drives Jest, pytest, and Playwright tests via fixture loaders. Validated by a CI linter.
- **`PersonaToken` fixture** — TS + Python helpers that mint a real Keycloak access token for a named persona, used by every test.
- **e2e test stack** — brought up by reusing `docker-compose.dev.yaml` with `COMPOSE_PROFILES="rbac,caipe-ui,caipe-supervisor,caipe-mongodb,dynamic-agents,rag,all-agents,slack-bot"`. An optional thin overlay `docker-compose/docker-compose.e2e.override.yaml` is layered in only to remap host ports (e.g., Mongo `27017→27018`) and inject e2e-only env vars when avoiding collision with a running dev stack. `make test-rbac` and Playwright drive both.
- **`KeycloakResourceCatalog`** — generated TypeScript constant (output of `scripts/extract-rbac-resources.py`) listing every `(resource, scope)` referenced in code, used at build time to verify realm-config completeness.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero BFF routes under `/api/admin/*`, `/api/dynamic-agents/*`, `/api/mcp-servers/*`, `/api/teams/*`, `/api/agents/*` use `requireAdmin`, `canViewAdmin`, raw group-claim checks, or any non-Keycloak gate after this PR. Verified by `scripts/validate-rbac-matrix.py`.
- **SC-002**: Zero Python services validate identity by reading `X-User-Context`. Verified by `rg "X-User-Context" ai_platform_engineering` returning only test fixtures and audit-log lines.
- **SC-003**: 100% of BFF routes in `tests/rbac-matrix.yaml` have at least one Jest test asserting allow + at least one asserting deny.
- **SC-004**: 100% of Python services in scope have at least one pytest test asserting JWKS validation, allow, deny, and PDP-unavailable role-fallback.
- **SC-005**: Playwright E2E suite covers at least 8 canonical user journeys (the 8 user stories above) end-to-end against real Keycloak, runs in under 10 minutes locally.
- **SC-006**: Adding a new BFF route to a protected prefix without a matrix entry causes `make test-rbac` to exit non-zero with a specific, actionable error message.
- **SC-007**: `how-rbac-works.md` quiz (10 questions auto-generated from the file map and component sections) is answerable in under 5 minutes by a reviewer who has not worked on this PR.
- **SC-008**: Total CI time for `make test-rbac` increases by no more than 4 minutes over the current `make test` + `make caipe-ui-tests` baseline.

## Open questions (for the user, before plan)

These do not block writing the spec, but the answers will shape the plan:

1. **PDP-unavailable behaviour for non-admin scopes** — `admin_ui#view` falls back to the `admin` realm role today. For `dynamic_agent#invoke`, `rag#retrieve`, `<agent>_mcp#read`, etc., should the PDP-unavailable fallback be (a) deny-all, (b) realm-role fallback per resource (e.g., `chat_user` for `rag#retrieve`), or (c) configurable per resource? Recommendation: **(c) configurable**, default deny-all, with a per-resource override list in `realm-config.json` extras.
2. **Where do the test fixtures live?** — `tests/` at repo root vs `tests/rbac/` vs colocate with each component (`ui/tests/rbac/`, `ai_platform_engineering/tests/rbac/`)? Recommendation: **single repo-root `tests/rbac/`** for the matrix and fixtures, with thin shims that import them from each component's existing test runner.
3. **Realm-config drift detection** — should the CI linter be a hard gate (fail PR) or advisory (warn)? Recommendation: **hard gate**.
4. **Slack OBO token-exchange enabled by default in dev compose?** — exchange requires Keycloak's token-exchange feature, which is gated behind `--features=token-exchange`. The dev compose currently doesn't enable it. Recommendation: **enable in `deploy/keycloak/docker-compose.yml`** so dev mirrors prod.
