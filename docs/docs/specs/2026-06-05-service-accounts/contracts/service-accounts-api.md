# API Contract: Service Accounts (BFF)

All routes under `ui/src/app/api/admin/service-accounts/`. All require an authenticated session.
All responses use the repo's `{ success, data?, error? }` envelope. Authorization is enforced
per-route (team membership / `service_account#can_manage`) regardless of UI state.

Common errors: `401` (unauthenticated), `403` (not a member of the relevant team / lacks
`can_manage`), `404` (SA not found or not visible to caller), `409` (name conflict), `503` (Mongo or
Keycloak/OpenFGA unavailable).

---

## `GET /api/admin/service-accounts`
List service accounts the caller can manage (active SAs in teams the caller belongs to). *(FR-014, FR-021)*

**Response 200**
```json
{ "success": true, "data": { "items": [
  { "id": "<sa_sub>", "name": "incident-bot", "description": "PagerDuty",
    "owning_team_id": "team-sre", "created_by": "<uuid>", "created_at": "…",
    "status": "active", "scope_counts": { "agents": 2, "tools": 5 } }
] } }
```
Never returns credential material. Revoked SAs excluded by default (`?include_revoked=true` optional).

---

## `POST /api/admin/service-accounts`
Create a service account. *(US1; FR-001..FR-008)*

**Request**
```json
{ "name": "incident-bot", "description": "PagerDuty integration",
  "owning_team_id": "team-sre",
  "scopes": [ { "type": "agent", "ref": "incident-resolver" },
              { "type": "tool",  "ref": "jira/search" } ] }
```

**Server flow**
1. `check(user:<caller>, member, team:<owning_team_id>)` → else `403`. *(FR-002)*
2. Name unique among active SAs in team → else `409`. *(FR-002a)*
3. For each requested scope: `check(user:<caller>, <rel>, <object>)`; drop/reject any not held.
   Reject the whole request if any requested scope is unauthorized (return which). *(FR-006/008)*
4. Keycloak: create confidential client → read back `client_uuid`, `client_secret`, and
   service-account-user `sub`. *(WS-B)*
5. OpenFGA: write `owner_team` tuple + one tuple per granted scope. *(data-model)*
6. Mongo: insert `service_accounts` doc (status `active`, `scopes_snapshot`).
7. Audit: `service_account.create`. *(FR-026)*

**Response 201** — the ONLY time the secret is returned. *(FR-005)*
```json
{ "success": true, "data": {
  "id": "<sa_sub>", "name": "incident-bot", "owning_team_id": "team-sre",
  "credential": { "client_id": "caipe-sa-incident-bot-a1b2c3", "client_secret": "<shown once>",
                  "token_url": "https://…/realms/caipe/protocol/openid-connect/token" },
  "granted_scopes": [ … ], "rejected_scopes": [] } }
```

---

## `GET /api/admin/service-accounts/:id`
Detail + current scopes (read from OpenFGA, not the snapshot). *(FR-014)*
`403` unless `check(user:<caller>, can_manage, service_account:<id>)`.

```json
{ "success": true, "data": {
  "id": "<sa_sub>", "name": "incident-bot", "description": "…", "owning_team_id": "team-sre",
  "created_by": "<uuid>", "created_at": "…", "status": "active",
  "scopes": [ { "type": "agent", "ref": "incident-resolver" },
              { "type": "tool",  "ref": "jira/search" } ] } }
```

---

## `POST /api/admin/service-accounts/:id/scopes`
Add a scope. *(US3; FR-015)*

**Request**: `{ "type": "agent" | "tool", "ref": "<id or server/tool>" }`

**Flow**: `check(can_manage)` → then `check(user:<editor>, <rel>, <object>)` (editor must hold it,
else `403`) → write tuple → update snapshot → audit `service_account.scope_add`. *(FR-015/026)*

---

## `DELETE /api/admin/service-accounts/:id/scopes`
Remove a scope. *(US3; FR-016)*

**Request**: `{ "type": "agent" | "tool", "ref": "<…>" }`

**Flow**: `check(can_manage)` ONLY (no requirement that the editor holds the scope) → delete tuple →
update snapshot → audit `service_account.scope_remove`. *(FR-016/026)*

---

## `POST /api/admin/service-accounts/:id/rotate`
Rotate the credential. *(US4; FR-017/019)*

**Flow**: `check(can_manage)` → Keycloak `POST /clients/{client_uuid}/client-secret` → audit
`service_account.rotate`. Scopes unchanged.

**Response 200** — new secret shown ONCE:
```json
{ "success": true, "data": { "credential": {
  "client_id": "caipe-sa-incident-bot-a1b2c3", "client_secret": "<new — shown once>",
  "token_url": "…" } } }
```

---

## `DELETE /api/admin/service-accounts/:id`
Revoke (terminal). *(US4; FR-018/018a)*

**Flow**: `check(can_manage)` → delete Keycloak client → delete ALL OpenFGA tuples for
`service_account:<id>` (ownership + scopes) → mark Mongo `status: "revoked"`, `revoked_at` (retain
doc for audit) → audit `service_account.revoke`. Name freed for reuse in the team. *(FR-018a)*

**Response 200**: `{ "success": true, "data": { "id": "<sa_sub>", "status": "revoked" } }`

---

## `GET /api/admin/service-accounts/grantable`
List the agents and tools the **calling user** currently holds, to populate the create/add-scope
picker. *(FR-009)*

`?team_id=` optional (does not affect the grantable set — that's the user's own perms, FR-007 — but
may be used to pre-select the owning team).

```json
{ "success": true, "data": {
  "agents": [ { "ref": "incident-resolver", "name": "Incident Resolver" } ],
  "tools":  [ { "ref": "jira/search", "name": "Jira: search" },
              { "ref": "jira/*", "name": "Jira: all tools" } ] } }
```
Backed by `listOpenFgaObjects(user:<caller>, can_use, agent)` and the tool equivalent. *(R-8)*

---

## Authentication for the resulting service account (out-of-band, not a BFF route)

The SA authenticates to CAIPE like any caller — it is NOT a special endpoint:
```
POST {token_url}                              # Keycloak
  grant_type=client_credentials&client_id=…&client_secret=…
  → { access_token: <JWT, sub=sa_sub, preferred_username=service-account-…, client_id=…> }

POST {CAIPE_API_URL}/api/v1/chat/invoke       # BFF (same route browsers/Slack use)
  Authorization: Bearer <JWT>
  → BFF validates (isServiceAccount=true) → forwards JWT to DA
  → DA: check service_account:<sub> can_use agent:<id>           (WS-G fix)
  → Gateway bridge per tool: agent can_call tool AND service_account:<sub> can_call tool  (WS-F)
```
*(FR-010/011/012/013)*
