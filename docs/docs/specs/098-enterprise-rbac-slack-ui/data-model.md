# Data model: Enterprise RBAC for Slack and CAIPE UI

Logical entities derived from [spec.md](./spec.md) and [architecture.md](./architecture.md). Field names are indicative; implementation may use snake_case in MongoDB or Keycloak attribute naming conventions.

## Storage split (FR-023)

| Store | What lives here |
|-------|-----------------|
| **Keycloak** | Realm roles, IdP group-to-role mappers, Authorization Services resources/scopes/policies (PDP data), user attributes (`slack_user_id`), OBO token exchange config, client credentials |
| **MongoDB** | Tenant config, team/KB ownership assignments, custom RAG tool bindings, app metadata, ASP tool policies, audit decision records |

---

## Keycloak-managed entities

### Keycloak Realm Role

| Field | Type | Notes |
|-------|------|--------|
| `name` | string | Role name, e.g. `admin`, `team_member(team-a)`, `kb_admin`, `chat_user` |
| `description` | string | Human-readable description |
| `composite` | boolean | Whether role contains other roles |

Mapped from IdP groups via IdP Mappers (Hardcoded Role, SAML Attribute to Role). See [architecture.md — IdP Groups → Keycloak Roles](./architecture.md#idp-groups--keycloak-roles-mapping-fr-010).

### Keycloak Authorization Services resource

| Field | Type | Notes |
|-------|------|--------|
| `name` | string | Component name from 098 matrix, e.g. `admin_ui`, `slack`, `supervisor`, `rag`, `tool`, `mcp` |
| `type` | string | Resource type, e.g. `caipe:component` |
| `scopes` | string[] | Capabilities from permission matrix, e.g. `view`, `create`, `delete`, `invoke`, `admin` |

### Keycloak Authorization Services policy

| Field | Type | Notes |
|-------|------|--------|
| `name` | string | Policy name, e.g. `admin-only`, `team-member-rag-access` |
| `type` | enum | `role` (role-based), `group`, `time`, `aggregate` |
| `roles` | string[] | Required realm roles for this policy |
| `logic` | enum | `POSITIVE` / `NEGATIVE` |
| `decision_strategy` | enum | `UNANIMOUS` / `AFFIRMATIVE` / `CONSENSUS` |

### Keycloak user attribute (Slack identity link)

| Field | Type | Notes |
|-------|------|--------|
| `slack_user_id` | string | Custom attribute on user profile; stores Slack user ID |

Written via Keycloak Admin API during identity linking (FR-025). Read via `GET /admin/realms/{realm}/users?q=slack_user_id:{id}`.

### OBO Token (runtime, not persisted)

| Field | Type | Notes |
|-------|------|--------|
| `sub` | string | Originating user's Keycloak subject ID |
| `act.sub` | string | Actor (bot service account) subject ID |
| `groups` | string[] | User's IdP groups (from claim mappers) |
| `roles` | string[] | User's resolved realm roles |
| `scope` | string | Granted scope (intersection of user entitlements and bot ceiling) |
| `org` | string | Tenant / organization ID |
| `iss` | string | Keycloak issuer URL |
| `aud` | string | Target audience (e.g. `caipe-platform`) |
| `exp` | number | Expiration (short-lived) |

Obtained via OAuth 2.0 Token Exchange (RFC 8693). Consumed by AG, supervisor, agents, and MCP servers.

### Keycloak Admin API Client (FR-024)

Server-side utility (`ui/src/lib/rbac/keycloak-admin.ts`) that authenticates via `client_credentials` grant using a service account with `realm-management` roles. Used exclusively by the Admin UI BFF to manage roles and IdP mappers without requiring Keycloak Admin Console access.

| Operation | Keycloak Endpoint | Purpose |
|---|---|---|
| List roles | `GET /admin/realms/{realm}/roles` | Populate roles table |
| Create role | `POST /admin/realms/{realm}/roles` | Admin creates custom role |
| Delete role | `DELETE /admin/realms/{realm}/roles-by-id/{id}` | Admin removes custom role |
| Get role by name | `GET /admin/realms/{realm}/roles/{name}` | Role detail lookup |
| List IdP aliases | `GET /admin/realms/{realm}/identity-provider/instances` | Populate IdP dropdown |
| List IdP mappers | `GET /admin/realms/{realm}/identity-provider/instances/{alias}/mappers` | Show group-to-role mappings |
| Create mapper | `POST /admin/realms/{realm}/identity-provider/instances/{alias}/mappers` | Admin maps group to role |
| Delete mapper | `DELETE /admin/realms/{realm}/identity-provider/instances/{alias}/mappers/{id}` | Admin removes mapping |

**Protected built-in roles** (cannot be deleted via Admin UI): `admin`, `chat_user`, `team_member`, `kb_admin`, `offline_access`, `uma_authorization`, `default-roles-caipe`

### Keycloak Admin API — User Management (FR-033)

Additional operations for the Admin UI User Detail View. Server-side utility in `ui/src/lib/rbac/keycloak-admin.ts`.

| Operation | Keycloak Endpoint | Purpose |
|---|---|---|
| Search users (paginated) | `GET /admin/realms/{realm}/users?search={q}&first={n}&max={m}&enabled={bool}` | Server-side paginated user list with text search and enabled filter |
| Count users | `GET /admin/realms/{realm}/users/count?search={q}&enabled={bool}` | Total count for pagination controls |
| Get user by ID | `GET /admin/realms/{realm}/users/{id}` | Full user representation for detail modal |
| Get user realm role mappings | `GET /admin/realms/{realm}/users/{id}/role-mappings/realm` | User's assigned realm roles |
| Assign realm roles to user | `POST /admin/realms/{realm}/users/{id}/role-mappings/realm` | Add roles (body: role representation array) |
| Remove realm roles from user | `DELETE /admin/realms/{realm}/users/{id}/role-mappings/realm` | Remove roles (body: role representation array) |
| Get user sessions | `GET /admin/realms/{realm}/users/{id}/sessions` | Last login timestamp |
| Get user federated identities | `GET /admin/realms/{realm}/users/{id}/federated-identity` | IdP source (alias + upstream user ID) |
| Enable/disable user | `PUT /admin/realms/{realm}/users/{id}` (with `enabled` field) | Account toggle |
| List users with role | `GET /admin/realms/{realm}/roles/{role-name}/users?first={n}&max={m}` | Role-based filter |

### Parsed role conventions (FR-033 modal display)

Per-KB and per-agent roles are **Keycloak realm roles** whose names follow naming conventions. The Admin UI parses these into structured objects for display:

| Pattern | Parsed type | Example |
|---------|-------------|---------|
| `kb_reader:<kb-id>` | Per-KB read | `kb_reader:platform-docs` |
| `kb_ingestor:<kb-id>` | Per-KB ingest | `kb_ingestor:team-a-docs` |
| `kb_admin:<kb-id>` | Per-KB admin | `kb_admin:team-a-docs` |
| `agent_user:<agent-id>` | Per-agent user | `agent_user:agent-123` |
| `agent_admin:<agent-id>` | Per-agent admin | `agent_admin:agent-456` |

---

## MongoDB-managed entities

### Tenant / organization

| Field | Type | Notes |
|-------|------|--------|
| `tenant_id` | string | Stable org identifier (slug or UUID) |
| `keycloak_realm` | string | Keycloak realm name for this tenant |
| `idp_issuer` | string | Expected OIDC issuer (Keycloak URL) |
| `display_name` | string | Human-readable org name |

### Team / KB ownership assignment

| Field | Type | Notes |
|-------|------|--------|
| `team_id` | string | Team identifier |
| `tenant_id` | string | Owning tenant |
| `kb_ids` | string[] | Knowledge bases assigned to this team |
| `allowed_datasource_ids` | string[] | Datasources the team may bind to RAG tools |
| `keycloak_role` | string | Corresponding Keycloak role, e.g. `team_member(team-a)` |
| `updated_at` | datetime | Last modification |

### Team-scoped RAG tool configuration

| Field | Type | Notes |
|-------|------|--------|
| `tool_id` | string | Unique id |
| `tenant_id` | string | |
| `team_id` | string | Owning team / scope |
| `name` | string | Display name |
| `datasource_ids` | string[] | Allow-list for retrieval binding |
| `created_by` | string | Subject id |
| `updated_at` | datetime | |

**Validation rules**

- `datasource_ids` ⊆ datasources the team is allowed to use (enforced on write via team ownership record).
- `team_id` immutable after create unless capability `rag.tool.transfer` (future) exists.

### Slack channel-to-team mapping (FR-031)

| Field | Type | Notes |
|-------|------|--------|
| `slack_channel_id` | string | Slack conversation ID; **unique** per document |
| `team_id` | string | CAIPE team id (MongoDB `teams._id` as string) |
| `slack_workspace_id` | string | Slack workspace / team id (`T…`) |
| `channel_name` | string | Denormalized display name (optional refresh from Slack API) |
| `created_by` | string | Admin user id or email who created the mapping |
| `created_at` | datetime | UTC |
| `active` | boolean | When `false`, mapping is ignored at runtime |

**Collection**: `channel_team_mappings`

**Indexes**: unique on `slack_channel_id`; optional compound `{ active: 1, slack_channel_id: 1 }` for admin list queries.

**Rules**

- Archived Slack channels do not emit bot events; mappings for those channels are effectively inert until the channel is used again.
- If `team_id` no longer exists in `teams`, the bot treats the mapping as invalid (fail closed), logs a warning, and denies with an admin-facing explanation.

#### Collection `channel_team_mappings` — formal field list (US9)

| Field | Type | Notes |
|-------|------|--------|
| `slack_channel_id` | string | **Unique** lookup key; one document per Slack conversation id |
| `team_id` | string | CAIPE team id (`teams._id` as string) |
| `slack_workspace_id` | string | Slack workspace id (`T…`) |
| `channel_name` | string | Denormalized label for Admin UI |
| `created_by` | string | Admin subject id or email |
| `created_at` | datetime | UTC |
| `active` | boolean | When `false`, mapping is ignored at runtime (soft delete) |

**Indexes**: unique on `slack_channel_id`; optional compound `{ active: 1, slack_channel_id: 1 }` for admin listings.

### Slack user operational metrics (optional, FR-032 dashboard)

| Field | Type | Notes |
|-------|------|--------|
| `slack_user_id` | string | Primary key for upserts |
| `last_interaction_at` | datetime | Last bot interaction |
| `obo_success_count` | number | Successful OBO exchanges (if recorded) |
| `obo_fail_count` | number | Failed OBO exchanges |
| `active_channel_ids` | string[] | Recently seen channel ids (cap length in application code) |

**Collection**: `slack_user_metrics` — populated by the bot when instrumentation is enabled; Admin UI joins to Keycloak users by `slack_user_id`.

### Authorization decision record (audit)

| Field | Type | Notes |
|-------|------|--------|
| `ts` | datetime | UTC |
| `tenant_id` | string | |
| `subject_hash` | string | Salted hash of subject |
| `actor_hash` | string | Salted hash of actor (for OBO flows) |
| `capability` | string | Permission matrix capability key |
| `component` | enum | `admin_ui` \| `slack` \| `supervisor` \| `rag` \| `sub_agent` \| `tool` \| `skill` \| `a2a` \| `mcp` |
| `resource_ref` | optional string | Tool id, KB id, route id, etc. |
| `outcome` | enum | `allow` \| `deny` |
| `reason_code` | string | e.g. `OK`, `DENY_NO_CAPABILITY`, `DENY_SCOPE`, `DENY_TENANT` |
| `pdp` | enum | `keycloak` \| `agent_gateway` |
| `correlation_id` | string | Request id |

### Bot service account (configuration)

| Field | Type | Notes |
|-------|------|--------|
| `client_id` | string | Keycloak client ID for the bot |
| `tenant_id` | string | Tenant this bot serves |
| `channel` | enum | `slack` \| `webex` |
| `scope_ceiling` | string[] | Maximum capabilities the bot may delegate (OBO scope ceiling) |

Registered in Keycloak as a confidential client with token exchange permission.

---

## Relationships

- **Tenant** 1—* **Team/KB ownership** (config, MongoDB).
- **Tenant** 1—1 **Keycloak realm** (config).
- **Team** 1—* **RAG tool configurations** (MongoDB).
- **Keycloak realm role** ←→ **IdP group** (via IdP mappers, Keycloak).
- **Keycloak AuthZ resource** ←→ **Permission matrix component** (098 matrix modeled as resources/scopes).
- **Principal** resolves capabilities via **Keycloak AuthZ** evaluation (PDP) for UI/Slack, or via **AG policy** for MCP/A2A.
- **OBO Token** carries **sub** (user) + **act** (bot) → consumed by AG and platform components.
- **Slack identity link** (Keycloak user attribute) → prerequisite for **OBO exchange** on Slack path.

### MongoDB Collection: `slack_link_nonces` (FR-025)

| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | Auto-generated |
| `nonce` | string | Unique, 32-byte hex-encoded CSPRNG value |
| `slack_user_id` | string | Slack user who initiated the linking request |
| `created_at` | datetime | UTC timestamp; TTL index expires documents after 600s (10 min) |
| `consumed` | boolean | `false` initially; set to `true` after successful OAuth callback |

**Indexes**: unique on `nonce`; TTL on `created_at` (expireAfterSeconds: 600).

**Lifecycle**: Bot generates nonce → stores in MongoDB → user clicks linking URL → BFF validates nonce (exists, not consumed, not expired) → performs OIDC code exchange → stores Keycloak user attribute → marks nonce consumed → sends Slack DM + renders success page. Expired documents auto-deleted by MongoDB TTL index.

### Slack Identity Linking Flow (FR-025 — updated)

```text
Slack User → /caipe command → Bot checks identity link
  ├── Link exists → OBO exchange → proceed
  └── No link → Bot sends "Link your account" DM with URL:
      https://{BFF_HOST}/api/auth/slack-link?nonce={nonce}&slack_user_id={id}
      User clicks → BFF validates nonce → Keycloak OIDC login →
      Code exchange → Extract keycloak_sub →
      Store slack_user_id as Keycloak user attribute →
      Mark nonce consumed →
      ├── Render browser success page
      └── Post Slack DM: "Your account is linked"
```

## State transitions

- **RAG tool**: `draft` → `active` → `deprecated` (optional); **delete** only with `rag.tool.delete` on owning scope.
- **Slack identity link**: `unlinked` → `linked` (via OAuth flow) → `invalidated` (if Keycloak account disabled/deleted).
- **Principal session**: groups refreshed on token refresh; fail closed if refresh fails (spec edge cases).
- **OBO token**: issued per request (short-lived); not persisted; scope = intersection of user entitlements and bot ceiling.
