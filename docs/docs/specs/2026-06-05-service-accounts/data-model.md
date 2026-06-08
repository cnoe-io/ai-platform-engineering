# Phase 1 Data Model: Service Accounts

Three stores of record, each authoritative for a different concern:

| Store | Owns | Source of truth for |
|-------|------|---------------------|
| **Keycloak** | the confidential client + its secret | the **credential** (identity) |
| **OpenFGA** | tuples on `service_account:<sub>` | **access** (ownership + scopes) |
| **MongoDB** | `service_accounts` document | **display metadata** (name, description, status, links) |

The Mongo doc is a convenience/index layer. Access decisions never read it; they read OpenFGA. The
credential is never stored anywhere in CAIPE — Keycloak holds it and shows it once.

---

## Entity: Service Account

### MongoDB document — collection `service_accounts`

```ts
// ui/src/types/mongodb.ts
export interface ServiceAccount {
  _id?: ObjectId;
  sa_sub: string;            // Keycloak service-account-user UUID — the OpenFGA subject id. UNIQUE.
  client_id: string;         // Keycloak clientId, e.g. "caipe-sa-incident-bot-a1b2c3". UNIQUE.
  client_uuid: string;       // Keycloak internal client UUID (for admin API calls: secret/delete).
  name: string;              // Human-friendly name, unique among ACTIVE SAs within owning_team_id.
  description?: string;
  owning_team_id: string;    // The single owning team (team slug/id used in OpenFGA team:<id>).
  created_by: string;        // Keycloak sub of the creating user (audit/display).
  created_at: Date;
  status: "active" | "revoked";
  revoked_at?: Date | null;
  // Display cache ONLY — not authoritative. OpenFGA tuples are the source of truth for access.
  scopes_snapshot?: ServiceAccountScope[];
}

export interface ServiceAccountScope {
  type: "agent" | "tool";
  // For agent: the agent id. For tool: "<server>/<toolname>" or "<server>/*".
  ref: string;
  added_by: string;          // Keycloak sub of who added this scope (audit).
  added_at: Date;
}
```

**No credential material is persisted** — no secret, no hash. (Contrast with `catalog_api_keys`,
which stores a hash; here Keycloak owns the secret entirely.)

### Indexes (created in `ui/src/lib/mongodb.ts` `createIndexes()`)

| Index | Type | Why |
|-------|------|-----|
| `{ sa_sub: 1 }` | unique | primary lookup by OpenFGA subject; one SA per Keycloak SA user |
| `{ client_id: 1 }` | unique | uniqueness of Keycloak client; lookup |
| `{ owning_team_id: 1, status: 1 }` | compound | list active SAs for a team (the main list query) |
| `{ owning_team_id: 1, name: 1, status: 1 }` | compound | enforce name-unique-among-active-in-team (FR-002a) |
| `{ created_by: 1 }` | — | audit / "created by me" filters |

> Name uniqueness (FR-002a) is enforced at the **application layer** on create (query active SAs in
> the team for the name), not via a partial unique index, to keep the "freed on revoke" semantics
> (FR-018a) simple and explicit. Documented as a deliberate choice.

### State transitions

```
(none) ──create──▶ active ──rotate──▶ active        (credential changes; status unchanged)
                     │
                     ├──add-scope / remove-scope──▶ active   (OpenFGA tuples change; doc.scopes_snapshot updated)
                     │
                     └──revoke──▶ revoked            (TERMINAL — FR-018a; Keycloak client deleted, tuples removed)
```

- `revoked` is terminal and irreversible. The doc is retained for audit; excluded from the active
  list; its `name` becomes reusable within the team (uniqueness is among `active` only).

---

## OpenFGA tuples (authoritative for access)

Written/removed by the BFF routes. `<sub>` = `sa_sub`; `<team>` = `owning_team_id`.

| Purpose | Tuple | Written when | Removed when |
|---------|-------|--------------|--------------|
| Ownership | `team:<team>#member` → `owner_team` → `service_account:<sub>` | create | revoke |
| Coarse-gate baseline | `service_account:<sub>` → `caller` → `mcp_gateway:list` | create | revoke |
| Agent grant | `service_account:<sub>` → `can_use` → `agent:<id>` | create / add-scope | remove-scope / revoke |
| Tool grant | `service_account:<sub>` → `can_call` → `tool:<server>/<tool>` (or `…/*`) | create / add-scope | remove-scope / revoke |

**Coarse-gate baseline (R-9 / #28):** the AgentGateway ext_authz bridge runs a coarse
`<subject> can_call mcp_gateway:list` check on EVERY MCP request before the per-tool checks. Humans get
this baseline at login bootstrap (`baseline-access.ts`); SAs never log in, so the create route writes
`service_account:<sub> caller mcp_gateway:list` explicitly (and revoke deletes it). Without it an SA
fails the coarse gate even with valid agent/tool grants. Requires the model change below
(`mcp_gateway.caller` now also accepts `service_account`).

Management authority derives from ownership: `service_account:<sub>#can_manage` = `owner_team`
(= any `team:<team>#member`). BFF authorizes manage actions with
`check(user:<editor>, can_manage, service_account:<sub>)`.

### Model changes (`deploy/openfga/model.fga`, mirrored into `authorization-model.json`)

```
type service_account
  relations
    define owner_team: [team#member]
    define can_manage: owner_team

type mcp_gateway
  relations
    define caller: [user, service_account]   # was [user] — added service_account (R-9/#29)
    define can_call: caller
```
(`service_account` was subject-only; the `owner_team`/`can_manage` relations are additive. `tool#caller`
already permits `user` and `service_account` — no change needed there. `mcp_gateway.caller` needed
`service_account` added so the coarse-gate baseline tuple above is writable.)

---

## Validation rules (from spec FRs)

- **FR-002**: `owning_team_id` MUST be a team the creating user belongs to (`check(user, member, team)`).
- **FR-002a**: `name` unique among `active` SAs within `owning_team_id`, compared **case-insensitively**
  (FR-002a). T007 normalizes (lowercases) the name for the uniqueness check; the original-cased name
  is stored for display.
- **FR-004**: a new SA has zero scope tuples until grants are written.
- **FR-006/008/015**: every agent/tool grant write is preceded by
  `check(user:<editor>, <relation>, <object>)`; reject on false.
- **FR-016**: scope removal requires only `check(user:<editor>, can_manage, service_account:<sub>)`
  (owning-team membership) — NOT holding the scope.
- **FR-020**: scopes are static; no process re-derives them from the creator over time.
- **FR-025**: team deletion blocked while any `service_account:<sub> owner_team team:<team>` exists.

---

## Entity relationships

```
team (1) ──owns──▶ (N) service_account ──grants──▶ (N) agent
                                        └─grants──▶ (N) tool
service_account (1) ◀──identity── (1) keycloak client ──has──▶ (1) client_secret  [shown once]
user (creator) ──created──▶ service_account        (audit only; no ongoing authority)
user (owning-team member) ──can_manage──▶ service_account   (via team membership)
```
