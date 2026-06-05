# Quickstart / Validation Scenarios: Service Accounts

End-to-end scenarios that validate the spec's acceptance criteria. Use these as the manual smoke
test and as the basis for integration tests. Assumes a dev stack (docker-compose) with Keycloak,
OpenFGA, MongoDB, BFF, DA backend, and AgentGateway + the OpenFGA ext_authz bridge enabled.

## Preconditions
- A test user **Alice** in team **`team-sre`** with `can_use agent:incident-resolver` and
  `can_call tool:jira/search` (but NOT `tool:github/create_issue`).
- A second user **Bob** in team **`team-marketing`** only (no overlap with Alice).
- AgentGateway bridge enabled with `CAIPE_AGENT_CONTEXT_HMAC_SECRET` set (so tool checks run).

---

## S1 — Create a scoped service account *(US1; FR-001..FR-009)*
1. As Alice, open **Admin → Settings → Service Accounts** → **Create**.
2. Confirm the owning-team dropdown lists **team-sre** (Alice's team).
3. Confirm the scope picker offers **incident-resolver** and **jira/search**, and does NOT offer
   `github/create_issue` (Alice lacks it). *(FR-009)*
4. Name it `incident-bot`, select both offered scopes, submit.
5. **Expect**: 201; credential (`client_id` + `client_secret` + token URL) shown **once**. *(FR-005)*
6. Dismiss the dialog, reopen the SA → **Expect**: no way to see the secret again. *(FR-005)*

**Pass**: SA created, owned by team-sre, two scope tuples written, secret revealed once.

## S2 — Default-deny on creation *(FR-004)*
Create `empty-bot` with NO scopes selected → **Expect**: created with zero grants; any later call it
makes is denied until scopes are added.

## S3 — Permission bound is enforced at write time *(FR-006/008)*
Via API (bypassing the UI), `POST /service-accounts` with a scope Alice lacks
(`tool:github/create_issue`) → **Expect**: `403`/rejected, that scope not written, response names the
rejected scope.

## S4 — Use the service account from outside *(US2; FR-010/011)*
1. `POST {token_url}` with `grant_type=client_credentials` + the SA's client_id/secret → get JWT.
   Confirm `sub` = the SA's UUID and `preferred_username` = `service-account-caipe-sa-incident-bot-…`.
2. `POST {CAIPE_API_URL}/api/v1/chat/invoke` with `Authorization: Bearer <JWT>` targeting
   `incident-resolver`.
3. **Expect**: authenticated as `service_account:<sub>`, agent-use allowed, agent runs. *(validates
   the WS-G DA fix — without it this wrongly 403s)*

## S5 — Agent access does NOT leak tool access *(US2; FR-012 — validates WS-F)*
1. Grant the SA `agent:incident-resolver` but NOT `tool:jira/search` (remove it if present).
2. Have the agent attempt a `jira/search` tool call under the SA's token.
3. **Expect**: tool call **denied** (`DENY_CALLER_TOOL`) even though `agent:incident-resolver
   can_call tool:jira/search` — because the SA caller lacks the tool grant.
4. Add `tool:jira/search` to the SA; retry → **Expect**: allowed (both agent and caller authorized).

## S5b — Human-user regression (the pre-existing gap) *(FR-012b — validates WS-F for users)*
1. As a user with `can_use agent:incident-resolver` but NOT `can_call tool:jira/search`, invoke the
   agent so it would call `jira/search`.
2. **Expect (post-fix)**: tool call **denied** for the human user too. (Pre-fix this leaked.)

## S6 — Manage scopes after creation *(US3; FR-015/016)*
1. As Alice (owning-team member), add `tool:jira/search` she holds → **Expect**: succeeds.
2. Add `tool:github/create_issue` she does NOT hold → **Expect**: `403`. *(FR-015)*
3. Remove a scope (any), including one added by another member → **Expect**: succeeds
   unconditionally. *(FR-016)*
4. Confirm the SA's credential is unchanged throughout. *(FR-019)*

## S7 — Rotate *(US4; FR-017/019)*
Rotate `incident-bot` → new secret shown once; old client_secret no longer obtains a token; scopes
unchanged.

## S8 — Revoke is terminal *(US4; FR-018/018a)*
Revoke `incident-bot` → its token no longer authenticates; all its OpenFGA tuples gone; it leaves the
active list; the Mongo doc is retained (`status: revoked`); the name `incident-bot` can be reused by
a new SA in team-sre. *(FR-018a)*

## S9 — Ownership boundary *(US5; FR-021/022)*
As Bob (team-marketing only), open Service Accounts → **Expect**: Alice's `incident-bot` is NOT
visible; direct API `GET/DELETE` on it → `403`/`404`. No way to share it to another team. *(FR-022)*

## S10 — Static access on creator permission loss *(FR-020)*
Remove Alice's own `can_use agent:incident-resolver`. The SA's `service_account:<sub> can_use
agent:incident-resolver` tuple is **unchanged**; the SA still works. *(FR-020)*

## S11 — Team deletion guard *(FR-025)*
Attempt to delete team-sre while it owns `incident-bot` → **Expect**: blocked with a clear message;
deletion succeeds only after the SA is revoked.

## S12 — Audit trail *(FR-026/027; SC-009)*
After S1, S6, S7, S8: confirm audit records exist for create / scope_add / scope_remove / rotate /
revoke (actor + target + scope). After S4/S5: confirm call-time allow/deny decisions are audited
(service account + resource). *(FR-027)*

---

## Automated test mapping
- **Bridge (pytest)** — `deploy/openfga/bridge/tests/test_grpc_bridge.py`: add cases for S5/S5b
  (caller-keyed deny for user + service_account; allow when both granted).
- **DA backend (pytest)** — service-account subject namespacing in `openfga_authz.py` (S4).
- **BFF (Jest)** — `service-accounts.ts` lib + each route: create/list/detail/rotate/revoke/scopes,
  the write-time permission bound (S3/S6), and ownership gating (S9).
- **Model** — a check that `service_account:<sub> can_manage` resolves from `owner_team`.
