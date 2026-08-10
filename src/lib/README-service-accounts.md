# Service Accounts (BFF library)

Self-service, team-owned bot identities for external/API callers. See the full
model in [RBAC Architecture › Service Accounts](../../../docs/docs/security/rbac/architecture.md#service-accounts-self-service-bot-identities)
and the flows in [RBAC Workflows › Service Account Create & External Call](../../../docs/docs/security/rbac/workflows.md#service-account-create--external-call).

## Three stores of record

| Store | Owns | Authoritative for |
|-------|------|-------------------|
| **Keycloak** | a confidential client per SA | the **credential** (never stored in CAIPE) |
| **OpenFGA** | tuples on `service_account:<sub>` | **access** (ownership + scopes) |
| **MongoDB** `service_accounts` | a display doc | **metadata** only |

Access decisions never read Mongo — they read OpenFGA. The credential lives only
in Keycloak and is shown once.

## Library files

| File | Responsibility |
|------|----------------|
| `service-accounts.ts` | Mongo wrapper: `createServiceAccountDoc`, `listByOwningTeams`, `getBySub`, `updateStatus`, `updateScopesSnapshot`, `isNameTakenInTeam` (case-insensitive, active-only). |
| `service-account-scopes.ts` | Scope ref parse/validate + the OpenFGA check/write tuple builders. |
| `rbac/keycloak-admin.ts` | `createServiceAccountClient`, `regenerateClientSecret`, `deleteServiceAccountClient`. |

## MongoDB `service_accounts` collection

No credential material is ever persisted (no secret, no hash). Fields: `sa_sub`
(OpenFGA subject = Keycloak service-account-user UUID, unique), `client_id`
(unique), `client_uuid`, `name`, `description?`, `owning_team_id`, `created_by`,
`created_at`, `status` (`active`|`revoked`), `revoked_at?`, `scopes_snapshot?`
(display cache only — OpenFGA is the source of truth).

Indexes (created in `mongodb.ts` `createIndexes()`):

| Index | Type | Why |
|-------|------|-----|
| `{ sa_sub: 1 }` | unique | primary lookup by OpenFGA subject |
| `{ client_id: 1 }` | unique | Keycloak client uniqueness |
| `{ owning_team_id: 1, status: 1 }` | compound | list active SAs for a team |
| `{ owning_team_id: 1, name: 1, status: 1 }` | compound | name-unique-among-active (FR-002a) |
| `{ created_by: 1 }` | — | audit / "created by me" |

> Name uniqueness is enforced in the **application layer** (case-insensitive,
> active-only) — not a partial unique index — so a revoked SA's name is freed for
> reuse within its team (FR-018a).

## Keycloak client naming

`caipe-sa-<slug>-<short-rand>` where `<slug>` is the lowercased,
hyphen-collapsed display name (≤32 chars) and `<short-rand>` is 6 hex chars
(uniqueness even when two teams reuse a display name). Clients are confidential,
`serviceAccountsEnabled: true`, `standardFlowEnabled: false`,
`directAccessGrantsEnabled: false` — mirroring `caipe-slack-bot`.

## Environment requirements

The BFF uses the existing Keycloak admin plumbing — no new variables:

| Variable | Purpose |
|----------|---------|
| `KEYCLOAK_ADMIN_CLIENT_ID` / `KEYCLOAK_ADMIN_CLIENT_SECRET` | `caipe-platform` confidential client (holds `realm-management:manage-clients`) used to create/rotate/delete SA clients. |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM` | Realm base for admin + token-URL construction. |
| `OPENFGA_HTTP`, `OPENFGA_STORE_NAME`/`OPENFGA_STORE_ID` | Authorization tuples. |
| `MONGODB_URI` | `service_accounts` collection. |

### AgentGateway bridge (caller-keyed tool enforcement, FR-012c)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAIPE_CALLER_TOOL_CHECK_ENABLED` | off | Enable the caller-keyed `<subject> can_call tool:…` check. **Default-off** for safe rollout — see [Workflows › Rollout safety](../../../docs/docs/security/rbac/workflows.md#rollout-safety-fr-012c--sc-011) before enabling in a shared environment. |

## REST API

`/api/admin/service-accounts` (`GET` list, `POST` create),
`/api/admin/service-accounts/[id]` (`GET` detail, `DELETE` revoke),
`/api/admin/service-accounts/[id]/rotate` (`POST`),
`/api/admin/service-accounts/[id]/scopes` (`POST` add, `DELETE` remove),
`/api/admin/service-accounts/grantable` (`GET`). The credential is returned ONLY
by create (201) and rotate (200) — never by list/detail (FR-005).
