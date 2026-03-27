# Research: Enterprise RBAC for Slack and CAIPE UI

**Phase 0 Output** | **Date**: 2026-03-25 | **Plan**: [plan.md](./plan.md)

## R-01: Keycloak Authorization Services vs Code-Based RBAC

**Decision**: Keycloak Authorization Services as PDP for UI/Slack paths (FR-022).

**Rationale**: Keycloak AuthZ provides resources, scopes, and policies natively — no custom PDP needed. Already partially implemented in `ui/src/lib/rbac/keycloak-authz.ts`. Sub-5ms decision latency achievable with local policy cache. Eliminates the previously considered `caipe-authorization-server` fallback.

**Alternatives considered**:
- Custom PDP service (`caipe-authorization-server`) — rejected; adds deployment complexity, Keycloak is already required
- OPA/Rego sidecar — rejected; CEL mandated (FR-029), adding OPA creates dual-engine maintenance
- Pure code-based checks — rejected; doesn't meet configurable policy requirement (FR-029)

## R-02: CEL Evaluator Library Selection

**Decision**: `cel-python` (Python), `cel-js` (TypeScript) — already in use across the codebase.

**Rationale**: Both libraries are already imported and operational in 4 services:
- UI: `ui/src/lib/rbac/cel-evaluator.ts` (cel-js)
- Python shared: `ai_platform_engineering/utils/cel_evaluator.py` (celpy)
- RAG server: `ai_platform_engineering/knowledge_bases/rag/server/src/cel_evaluator.py`
- Dynamic agents: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/cel_evaluator.py`

**Shared CEL context schema** (FR-029): `user.roles`, `user.teams`, `user.email`, `user.org`, `resource.id`, `resource.type`, `resource.visibility`, `resource.owner_id`, `resource.shared_with_teams`.

**Alternatives considered**:
- Google CEL-Go with WASM — rejected; adds compilation step, not needed when native libraries work
- Custom expression parser — rejected; violates FR-029 (CEL mandated)

## R-03: OBO Token Exchange with Keycloak

**Decision**: OAuth 2.0 Token Exchange (RFC 8693) via Keycloak's built-in token exchange endpoint.

**Rationale**: Keycloak supports token exchange natively (`/realms/{realm}/protocol/openid-connect/token` with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`). The resulting token carries `sub` (user), `act` (bot/agent), `scope`, `roles`, and `org` claims. Requires enabling the token-exchange feature on the Keycloak realm and granting the bot service account the `token-exchange` client role.

**Key configuration**:
- Enable `token-exchange` feature flag on Keycloak realm
- Create `caipe-bot` client (confidential, service account enabled)
- Grant `token-exchange` permission to `caipe-bot` for `caipe-ui` client
- Bot exchanges Slack user identity → Keycloak OBO token → forwarded to AG/supervisor

**Alternatives considered**:
- Custom JWT minting in bot backend — rejected; violates RFC 8693, not verifiable by AG
- Passing Slack user context as metadata without token — rejected; AG requires JWT validation

## R-04: Agent Gateway Deployment with Keycloak

**Decision**: Deploy AG as a standalone sidecar or Kubernetes service, configured with Keycloak as OIDC provider.

**Rationale**: AG already has a [Keycloak tutorial](https://agentgateway.dev/docs/kubernetes/latest/mcp/auth/keycloak/) for MCP auth. AG validates JWT `iss` against Keycloak JWKS endpoint, applies CEL policy rules. For local dev, AG runs as a Docker container alongside Keycloak.

**Key configuration**:
- AG OIDC provider: Keycloak realm JWKS endpoint
- CEL policy rules mirror the 098 permission matrix rows for MCP tool invocation
- Fail-closed: if AG is down, MCP/A2A/agent requests are denied

**Alternatives considered**:
- Envoy + ext-authz — rejected; AG is purpose-built for MCP/A2A, Envoy is generic
- No gateway (direct MCP) — rejected; FR-013 mandates AG for MCP/A2A/agent traffic

## R-05: Slack Identity Linking Flow

**Decision**: Interactive OAuth account linking via BFF callback at `/api/auth/slack-link` (FR-025).

**Rationale**: The BFF already has NextAuth/Keycloak integration. The flow:
1. Bot generates linking URL with single-use nonce (10min TTL) + `slack_user_id`
2. User clicks URL → redirected to Keycloak OIDC login (via federated IdP)
3. BFF callback handles auth code exchange → extracts `keycloak_sub`
4. BFF stores `slack_user_id` as Keycloak user attribute via Admin API
5. BFF posts confirmation DM via Slack Web API
6. Subsequent commands: bot queries Keycloak Admin API (find user by `slack_user_id` attribute) → OBO exchange

**Nonce storage**: MongoDB `slack_link_nonces` collection (ephemeral, 10min TTL index).

**Alternatives considered**:
- Slack bot hosts its own HTTP server for callback — rejected; adds HTTP capability to Python bot, duplicates BFF
- Store link mapping in MongoDB instead of Keycloak — rejected; centralizes identity in Keycloak, removes MongoDB dependency from Slack bot identity path

## R-06: Supervisor Test Failures (217 failures)

**Decision**: Install `pytest-asyncio` as dev dependency; most failures are missing async test support.

**Rationale**: The error message shows `Failed: async def functions are not natively supported. You need to install a suitable plugin for your async framework, for example: pytest-asyncio`. This is a dependency gap, not test logic bugs. After installing, remaining failures (if any) will be individual test issues.

**Additional findings**:
- `pytest-cov` is not installed — needed for coverage measurement
- Root `tests/` directory is NOT in `pyproject.toml` `testpaths` — tests only run when explicitly invoked via `pytest tests/`
- The `pyproject.toml` `testpaths` only lists `ai_platform_engineering/utils` and `ai_platform_engineering/multi_agents`

**Action**: Add `pytest-asyncio`, `pytest-cov` to dev dependencies; add `tests/` to `testpaths`.

## R-07: UI Test Failures (218 failures across 25 suites)

**Decision**: Triage and fix by category — most failures are likely mock/import issues from recent code changes.

**Rationale**: With 1,876 passing tests and 218 failing, the failures are concentrated in 25 of 105 suites. Common causes in Next.js test suites:
- Module mock mismatches after refactoring (e.g., `canViewAdmin` removal)
- Async timing issues in `waitFor` assertions
- Missing mock providers or changed API signatures

**Action**: Run each failing suite individually, categorize failures, fix in batches. Priority: API tests (admin, auth) → component tests → hook tests.

## R-08: User Self-Service RBAC Posture View

**Decision**: New API route `/api/auth/my-roles` + read-only panel in user menu (FR-036).

**Rationale**: The admin user detail modal (FR-033) already aggregates realm roles, teams, per-KB roles, per-agent roles, and IdP source. The self-service view reuses the same data fetching but scoped to the authenticated user's own `keycloak_sub`. No Keycloak Admin API access needed for the frontend — the BFF route fetches from Keycloak Admin API server-side and returns only the current user's data.

**Data sources**:
- Keycloak Admin API: realm roles, per-KB/agent roles (parsed from role names), IdP source, account status
- MongoDB: team memberships (from team documents)
- Session: email, name, sub (already available)

**Alternatives considered**:
- Extract from JWT claims only — rejected; JWT doesn't contain team memberships or per-KB/agent role details
- Link to Keycloak Account Console — rejected; poor UX, requires separate login, doesn't show CAIPE teams
