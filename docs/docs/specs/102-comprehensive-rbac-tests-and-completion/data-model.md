# Phase 1 Data Model: Comprehensive RBAC Tests + Completion of 098

**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md) | **Research**: [`research.md`](./research.md)

This document captures every entity (collection, file, in-memory object) introduced or significantly extended by this spec, with its fields, validation rules, relationships, and state transitions where applicable. It is the input to the contracts (`/contracts/`) and to the test fixtures.

---

## E1 — `authz_decisions` (MongoDB collection) **NEW**

### Purpose
Append-only audit log of every authorization decision made by any TS or Py gate.

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | yes (auto) | Mongo default. |
| `userId` | string | yes | Keycloak `sub` claim. `"anonymous"` if no auth context. |
| `userEmail` | string | no | Best-effort copy of email/preferred_username for human-readability. Never used for authorization. |
| `resource` | string | yes | Keycloak resource name. E.g. `"admin_ui"`, `"argocd_mcp"`, `"dynamic_agent:my-agent"`. |
| `scope` | string | yes | Keycloak scope name. E.g. `"view"`, `"read"`, `"invoke"`. |
| `allowed` | boolean | yes | Outcome. |
| `reason` | enum string | yes | One of: `OK`, `OK_ROLE_FALLBACK`, `OK_BOOTSTRAP_ADMIN`, `DENY_NO_CAPABILITY`, `DENY_PDP_UNAVAILABLE`, `DENY_INVALID_TOKEN`, `DENY_RESOURCE_UNKNOWN`. |
| `source` | enum string | yes | `"ts"` or `"py"`. Identifies which runtime emitted the record. |
| `service` | string | yes | Service name (e.g., `"ui"`, `"supervisor"`, `"argocd_mcp"`, `"dynamic_agents"`, `"rag_server"`, `"slack_bot"`). |
| `route` | string | no | HTTP route (TS BFF) or RPC method (Py services). E.g. `"GET /api/admin/users"`, `"tools/call argocd.list_apps"`. |
| `requestId` | string | no | Correlation id from inbound request, if present. |
| `ts` | ISODate | yes | Server time of decision. |

### Indexes

| Index | Purpose |
|---|---|
| `{userId: 1, ts: -1}` | "What did this user try?" dashboards. |
| `{resource: 1, scope: 1, ts: -1}` | "Who tried to invoke this resource?" investigations. |
| `{allowed: 1, ts: -1}` | Deny-rate dashboards / alerting. |
| (recommended, not in this PR) `{ts: 1}` with `expireAfterSeconds` | Retention. |

### Lifecycle
- **Insert-only.** No updates, no deletes. Operators add a TTL index for retention if desired.
- Write failures are logged at WARN level and swallowed per FR-007 (gate decision proceeds).

### Schema reference
[`contracts/audit-event.schema.json`](./contracts/audit-event.schema.json)

---

## E2 — `tests/rbac-matrix.yaml` (file) **NEW**

### Purpose
Single source of truth for *which persona may do what against which gate*. Drives Jest, pytest, and Playwright test parameterisation. Verified by `scripts/validate-rbac-matrix.py` (CI hard gate, FR-010).

### Top-level shape

```yaml
version: 1
routes:
  - id: admin-users-list
    surface: ui_bff           # one of: ui_bff, supervisor, mcp_<agent>, dynamic_agents, rag, slack_bot
    method: GET               # HTTP method (or "rpc" for non-HTTP)
    path: /api/admin/users    # HTTP path or RPC method name
    resource: admin_ui        # Keycloak resource
    scope: view               # Keycloak scope
    expectations:
      alice_admin: { status: 200 }
      bob_chat_user: { status: 403, reason: DENY_NO_CAPABILITY }
      carol_kb_ingestor: { status: 403, reason: DENY_NO_CAPABILITY }
      dave_no_role: { status: 403, reason: DENY_NO_CAPABILITY }
      eve_dynamic_agent_user: { status: 403, reason: DENY_NO_CAPABILITY }
      frank_service_account: { status: 403, reason: DENY_NO_CAPABILITY }
```

### Validation rules

- `version: 1` required.
- `routes[*].id` MUST be unique across the file.
- `routes[*].surface` MUST match one of the seven enums above.
- `routes[*].resource` and `routes[*].scope` MUST exist as a `(resource, scope)` pair in `deploy/keycloak/realm-config.json` (cross-validation by `scripts/validate-realm-config.py`).
- `routes[*].expectations` MUST cover all six personas (no missing entries).
- `expectations.<persona>.status` MUST be a 3-digit HTTP status.
- `expectations.<persona>.reason` is required when status ≥ 400.

### Schema reference
[`contracts/rbac-matrix.schema.json`](./contracts/rbac-matrix.schema.json)

---

## E3 — `deploy/keycloak/realm-config-extras.json` (file) **NEW**

### Purpose
Per-resource PDP-unavailable fallback rules (resolution of Open Question 1). Sibling to `realm-config.json` so it can be edited without touching the Keycloak import.

### Shape

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

### Validation rules
- `version: 1` required.
- Every key under `pdp_unavailable_fallback` MUST match a resource defined in `realm-config.json`.
- `mode` MUST be `"realm_role"` or `"deny_all"`.
- If `mode == "realm_role"`, `role` is required and MUST match a realm role defined in `realm-config.json`.
- Resources NOT listed get implicit `{ mode: "deny_all" }` behaviour.

### Schema reference
[`contracts/realm-config-extras.schema.json`](./contracts/realm-config-extras.schema.json)

---

## E4 — `KeycloakResourceCatalog` (in-memory TS constant) **NEW**

### Purpose
Build-time-emitted TypeScript module listing every `(resource, scope)` referenced by either runtime. Used by `scripts/validate-realm-config.py` to assert realm-config completeness.

### Generation
`scripts/extract-rbac-resources.py` walks the codebase:
- TS: `rg "requireRbacPermission\(.*?,\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]"`
- Py: `rg "require_rbac_permission\(.*?,\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]"`

### Shape (emitted)

```typescript
// AUTO-GENERATED by scripts/extract-rbac-resources.py — do not edit
export const KEYCLOAK_RESOURCE_CATALOG = {
  admin_ui: { scopes: ['view', 'manage'] satisfies readonly string[] },
  argocd_mcp: { scopes: ['read', 'write'] satisfies readonly string[] },
  // ...
} as const;
```

### Lifecycle
Regenerated by `make test-rbac` before validation. Drift causes CI failure.

---

## E5 — `PersonaToken` test fixture (TS + Py) **NEW**

### Purpose
Mint a real Keycloak access token for a named persona. Used by every Jest, pytest, and Playwright test.

### Behaviour
- On first call per persona per test session: POSTs to Keycloak `/realms/caipe/protocol/openid-connect/token` (Resource Owner Password Credentials grant for test users — never enabled in production).
- Caches the access token + refresh token for the duration of the test session, refreshing 30s before expiry.
- Exposes both raw access token (for header injection) and decoded claims (for assertion).

### TS API (`tests/rbac/fixtures/keycloak.ts`)

```typescript
export interface PersonaToken {
  accessToken: string;
  refreshToken: string;
  decodedClaims: Record<string, unknown>;
}
export async function getPersonaToken(name: PersonaName): Promise<PersonaToken>;
export async function clearPersonaCache(): Promise<void>;
export type PersonaName =
  | 'alice_admin' | 'bob_chat_user' | 'carol_kb_ingestor'
  | 'dave_no_role' | 'eve_dynamic_agent_user' | 'frank_service_account';
```

### Py API (`tests/rbac/fixtures/keycloak.py`)

```python
@dataclass(frozen=True)
class PersonaToken:
    access_token: str
    refresh_token: str
    decoded_claims: dict[str, Any]

def get_persona_token(name: PersonaName) -> PersonaToken: ...
def clear_persona_cache() -> None: ...
```

`conftest.py` exposes pytest fixtures `alice_admin`, `bob_chat_user`, etc. that return `PersonaToken` objects (parameterised tests use `@pytest.mark.parametrize("persona", PERSONAS)`).

### Realm setup
Personas are created at compose-stack-up time by `deploy/keycloak/init-idp.sh` (existing script, extended in Phase 0 to seed the six personas with their roles, team memberships, and per-KB role assignments).

---

## E6 — `team_kb_ownership` (MongoDB collection) **EXTENDED**

### Purpose
Maps Knowledge Base IDs to teams. Already exists from spec 098. This spec consumes it for the RAG hybrid gate (Story 4).

### Fields
| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | yes | |
| `kbId` | string | yes | E.g. `"team-a-docs"`. Indexed unique. |
| `ownerTeamId` | string | yes | Mongo `teams._id` reference. |
| `createdAt` | ISODate | yes | |
| `updatedAt` | ISODate | yes | |

### Lifecycle
Created by the team-management UI when a KB is provisioned. This spec adds **no new mutations** — it only reads.

### How it interacts with Keycloak (this spec adds)
For each `kbId`, the team-management UI creates two realm roles when a KB is provisioned (already in spec 098 implementation):
- `kb_reader:<kbId>` — read access
- `kb_ingestor:<kbId>` — read+write access

The RAG server's hybrid gate computes the user's accessible KB set as:
```
accessible_kbs(user) = {
  kb for kb in TeamKbOwnership
  if user is member of TeamKbOwnership[kb].ownerTeamId  (Mongo path)
} ∪ {
  kb for kb in TeamKbOwnership
  if user has realm role kb_reader:<kb> or kb_ingestor:<kb>  (Keycloak path)
}
```

---

## Relationships

```text
Persona (Keycloak user)
  ├── has realm roles (admin, chat_user, kb_ingestor, agent_user:<id>, etc.)
  ├── has user attributes (slack_user_id, team_ids[])
  └── (when used in tests) returns a PersonaToken

PersonaToken
  └── used to construct Authorization: Bearer header for tests

rbac-matrix.yaml
  ├── route entries reference (resource, scope) pairs
  └── route entries reference Persona names

realm-config.json
  ├── defines resources (admin_ui, argocd_mcp, ..., dynamic_agent, rag, slack)
  ├── defines scopes per resource (view, read, write, invoke, manage, ...)
  ├── defines policies binding roles to (resource, scope)
  └── (NEW: defines per-agent resources e.g. dynamic_agent:my-agent at provision time)

realm-config-extras.json
  └── per-resource PDP-unavailable fallback overrides

KeycloakResourceCatalog (generated)
  ├── extracted from code by walking requireRbacPermission calls
  └── compared to realm-config.json by validate-realm-config.py

authz_decisions (Mongo)
  ├── one document per gate decision
  ├── written by both TS and Py runtimes
  └── queried by tests to assert "gate fired" (Story 1 ac6)

team_kb_ownership (Mongo)
  ├── maps kbId → teamId
  └── consumed by RAG hybrid gate
```

---

## State transitions

The only state machine introduced by this spec is the **PDP decision flow** (mirrors `call-sequences.md` Flow 1 in code form):

```text
[entry: requireRbacPermission(session, resource, scope)]
  │
  ├─→ extract bearer from session
  │
  ├─→ permissionDecisionCache.get(sha256(token):resource#scope)?
  │     ├─ HIT → return cached.{result, expiresAt}
  │     └─ MISS → continue
  │
  ├─→ POST Keycloak /token (uma-ticket grant)
  │     ├─ 200 + result:true  → cache + return allow
  │     ├─ 403                → return deny(DENY_NO_CAPABILITY)
  │     └─ network error      → fallback evaluation (next step)
  │
  ├─→ if denied via PDP: hasRoleFallback(token, resource)?
  │     ├─ realm-config-extras has rule for resource:
  │     │     ├─ mode=realm_role + token has role → return allow(OK_ROLE_FALLBACK)
  │     │     └─ otherwise → return deny(DENY_NO_CAPABILITY)
  │     └─ no rule → return deny(DENY_NO_CAPABILITY)
  │
  ├─→ if PDP unreachable (network error): use realm-config-extras
  │     ├─ rule says realm_role + token has role → return allow(OK_ROLE_FALLBACK)
  │     ├─ rule says deny_all                    → return deny(DENY_PDP_UNAVAILABLE)
  │     └─ no rule (default)                     → return deny(DENY_PDP_UNAVAILABLE)
  │
  └─→ logAuthzDecision({outcome, reason, ...}) (best-effort, swallow failures)
```

---

## Out of scope for this data model

- **`teams` collection schema** — already defined by spec 098.
- **`slack_user_metrics` collection schema** — already defined by spec 098.
- **NextAuth session shape** — preserved; this spec reads from it but does not change it.
- **Keycloak session storage** — Keycloak-internal; not modelled here.
