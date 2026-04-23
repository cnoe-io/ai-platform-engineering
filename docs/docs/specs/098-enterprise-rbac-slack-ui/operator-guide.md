# Operator Guide: Enterprise RBAC (098)

**Audience**: Platform operators deploying CAIPE with Keycloak, Agent Gateway, and the CAIPE UI BFF.  
**Sources of truth**: `deploy/keycloak/realm-config.json`, `deploy/agentgateway/config.yaml`, `ui/src/lib/api-middleware.ts`, `ui/src/lib/rbac/`, RAG server `rbac.py`.

## 1. Keycloak realm setup (`caipe`)

### 1.1 Import and dev stack

- Realm export: `deploy/keycloak/realm-config.json` is bind-mounted into the Keycloak container by `deploy/keycloak/docker-compose.yml` as `--import-realm` data (see that compose file for ports; quickstart uses `http://localhost:7080`).
- After import, verify realm **`caipe`** is enabled and clients exist (below).

### 1.2 Realm roles (global)

Defined under `roles.realm` in `realm-config.json`:

| Role | Purpose (from export descriptions) |
|------|-------------------------------------|
| `admin` | Full platform administration |
| `chat_user` | Invoke supervisor, tools, MCP, A2A, skills (baseline chat user) |
| `team_member` | Create/manage team-scoped RAG tools |
| `kb_admin` | KB administration and ingest |
| `offline_access` | Refresh tokens (OIDC) |
| `uma_authorization` | UMA / Authorization Services participation |

**Note**: `denied` in the permission matrix is a *test persona* (user with no chat roles), not a realm role in the export.

### 1.3 Per-resource and per-KB realm roles (conventions)

The export includes **examples** of fine-grained KB roles; production deployments add more the same way:

| Pattern | Meaning |
|---------|---------|
| `kb_reader:<kb-id>` | Read/query KB `<kb-id>` |
| `kb_ingestor:<kb-id>` | Ingest into `<kb-id>` |
| `kb_admin:<kb-id>` | Admin for `<kb-id>` |
| `kb_reader:*` | Read all KBs (wildcard) |

**Agent / task / skill** roles follow the spec (FR-028): `agent_user:<id>`, `agent_admin:<id>`, and analogously **`task_user:<id>`**, **`task_admin:<id>`**, **`skill_user:<id>`**, **`skill_admin:<id>`** with wildcards `:*` where appropriate. These are **not** all pre-created in `realm-config.json`; assign them via Admin UI / Keycloak Admin API when provisioning resources.

### 1.4 Keycloak Authorization Services resources

Client **`caipe-platform`** has `authorizationServicesEnabled: true` and defines **resources** (type `caipe:component`) with scopes:

| Resource | Scopes (subset) |
|----------|-----------------|
| `admin_ui` | `view`, `configure`, `admin`, `audit.view` |
| `slack` | `view`, `invoke`, `admin` |
| `supervisor` | `invoke`, `configure`, `admin` |
| `rag` | `query`, `ingest`, `admin`, `tool.create`, `tool.update`, `tool.delete`, `tool.view`, `kb.admin`, `kb.ingest`, `kb.query` |
| `sub_agent` | `invoke`, `configure`, `admin` |
| `tool` | `invoke`, `configure`, `admin` |
| `skill` | `view`, `invoke`, `configure`, `delete` |
| `a2a` | `create`, `view`, `configure`, `delete`, `admin` |
| `mcp` | `invoke`, `view`, `admin` |

**Policies** in the export map realm roles to these scopes (e.g. `admin-role-policy`, `chat-user-role-policy`, `team-member-role-policy`, `kb-admin-role-policy` plus composite scope policies such as `rag-query-access`, `rag-team-tool-access`, `slack-access`). Operators should extend policies when product matrix rows require roles beyond what the sample export grants (see [permission-matrix.md](./permission-matrix.md) § Keycloak export alignment).

### 1.5 Clients

| Client ID | Purpose | Notes from export |
|-----------|---------|-------------------|
| **`caipe-ui`** | Next.js / NextAuth OIDC | Confidential, standard flow, `authorizationServicesEnabled: false`, redirect `http://localhost:3000/*` (adjust for prod) |
| **`caipe-platform`** | Resource server + PDP for UMA | Authorization Services **enabled**; used as **audience** for permission checks and Agent Gateway JWT audience |
| **`caipe-slack-bot`** | Bot service account + OBO | `serviceAccountsEnabled: true`, `standardFlowEnabled: false`, `directAccessGrantsEnabled: false`, attribute `oidc.token.exchange.enabled: true` |

### 1.6 Client scopes and protocol mappers

Default realm client scopes (`defaultDefaultClientScopes`): `profile`, `email`, `roles`, `groups`, `org`.

Important mappers:

- **`roles` scope** — `realm-roles` → JWT claim **`roles`** (multivalued string), also on userinfo/id token per mapper config.
- **`groups` scope** — maps user attribute **`idp_groups`** → claim **`groups`** (FR-010; populated by IdP / broker mappers).
- **`org` scope** — user attribute **`org`** → claim **`org`** (tenant hint, FR-020).
- **`profile` scope** — includes **`caipe-audience`** mapper adding custom audience **`caipe-platform`** to tokens so resource-server and AG validation can accept them.

Identity provider mappers (Okta / Entra examples in export) illustrate importing groups into `idp_groups` and optional hardcoded role assignment from IdP group values.

### 1.7 Sample users

`realm-config.json` includes seed users (e.g. `admin@example.com`, `standard@example.com`, `kbadmin@example.com`, `denied@example.com`, `orgb@example.com`) with differing realm roles for testing—**change passwords before any non-local use**.

---

## 2. Agent Gateway deployment

### 2.1 Layout

- Compose: `deploy/agentgateway/docker-compose.yml`
- Config: `deploy/agentgateway/config.yaml`

### 2.2 JWT validation (strict mode)

From `config.yaml`:

- Listener **`jwtAuth`**: `mode: strict`
- **`issuer`**: `http://localhost:7080/realms/caipe` (set to your realm issuer in each environment)
- **`audiences`**: `[caipe-platform]`
- **`jwks.url`**: realm JWKS (compose uses `http://keycloak:7080/realms/caipe/protocol/openid-connect/certs` for in-network Keycloak)

### 2.3 HTTP route CEL (tenant + subject)

Authorization rules on the HTTP route:

- Deny if no `jwt.sub`
- Deny if `jwt.org` and header `x_tenant_id` both present and differ (tenant mismatch)
- Allow if `jwt.sub` present

### 2.4 MCP authorization CEL (`mcpAuthorization.rules`)

Rules are **allow-if-any-match** (documented inline in config). They gate tool names by prefix and realm roles in **`jwt.realm_access.roles`**, including:

- Admin-only: `admin_*`, `supervisor_config*`
- RAG: `rag_query*`, `rag_ingest*`, `rag_tool*`
- Team tools: `team_*` (with `admin` / `kb_admin` / `team_member` branches)
- Dynamic agent tools: names starting with `dynamic_agent_` for chat/team/kb_admin/admin roles
- General tools: chat-capable roles excluding admin/rag_ingest/supervisor_config prefixes

**`mcp.targets`** is empty in the sample—set real MCP backend URLs per environment.

### 2.5 Production checklist

- TLS termination and correct **issuer** / **JWKS** URLs for your Keycloak hostname
- Rotate secrets; do not use dev client secrets from the repo export
- Align CEL rules with [permission-matrix.md](./permission-matrix.md) and your IdP role names

---

## 3. CEL policy rules (where they live)

### 3.1 Admin UI tab gates (`admin_tab_policies`)

- **Storage**: MongoDB collection **`admin_tab_policies`**
- **API**: `GET/PUT` via BFF routes under `ui/src/app/api/rbac/admin-tab-gates/` and policies listing `admin-tab-policies`
- **Behavior**: CEL runs per tab; context includes `user.email`, `user.roles` (JWT realm roles plus session/bootstrap admin), `user.teams`, and feature flags are **AND**ed with CEL for several tabs (see `docs/docs/api/rbac-roles.md`)

### 3.2 BFF route CEL (`CEL_RBAC_EXPRESSIONS`)

- **Env**: `CEL_RBAC_EXPRESSIONS` — JSON map of **`resource#scope`** → CEL expression string
- **Applied in**: `requireRbacPermission()` in `ui/src/lib/api-middleware.ts` **after** Keycloak allows or role-fallback allows
- **Evaluator**: `ui/src/lib/rbac/cel-evaluator.ts` — failures **fail closed** (deny)

### 3.3 Agent Gateway

- Inline CEL in `deploy/agentgateway/config.yaml` (see §2)

### 3.4 RAG server (optional CEL layer)

- **Env**: `CEL_KB_ACCESS_EXPRESSION`, `CEL_KB_ACCESS_EXPRESSIONS` (JSON map per KB/datasource)
- **Code**: `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py`
- If expressions are set but `cel_evaluator` is unavailable, KB filtering **denies** (fail-closed) or returns 503 when enforcement is required—see code paths `_filter_kb_ids_by_cel` / `_enforce_cel_kb_access`

Per-KB access also uses Keycloak roles and MongoDB team ownership **without** requiring CEL to be configured (CEL is an additional configurable layer per FR-029).

---

## 4. ASP tool policy composition (FR-012)

Enterprise RBAC (Keycloak / AG realm roles + matrix) and **ASP / Global Tool Authorization** are separate layers:

1. RBAC evaluated first (BFF Keycloak UMA or AG CEL).
2. If RBAC **denies** → request denied.
3. If RBAC **allows** → ASP still applies where wired (e.g. supervisor tool filtering).
4. If ASP **denies** → **deny wins** (effective access = **intersection**).

Documented in [permission-matrix.md](./permission-matrix.md) § Composition with ASP.

---

## 5. Fail-closed behavior

### 5.1 Keycloak unavailable (BFF / UI path)

- `checkPermission()` in `ui/src/lib/rbac/keycloak-authz.ts` returns `DENY_PDP_UNAVAILABLE` on network/HTTP errors.
- `requireRbacPermission()` then **does not** use role fallback for that outcome: it logs and throws **503** *"Authorization service unavailable — access denied (fail-closed)"*.
- When Keycloak returns a normal **403** denial, the user gets **403** with the standard denial payload.

**Role fallback** applies only when PDP returns a negative result that is **not** classified as PDP unavailable (see code: fallback for `admin_ui`/`supervisor`/`rag` minimum roles)—intended for gradual rollout, not for bypassing a down PDP.

### 5.2 Agent Gateway unavailable

- MCP/A2A/agent traffic cannot be validated or proxied → requests **fail** (connection errors). Product expectation (FR-013): **fail closed**—no silent bypass around AG for those paths.

### 5.3 MongoDB unavailable

- **Admin tab CEL gates**: depend on MongoDB for `admin_tab_policies`; failures should not grant tabs (implementation returns safe defaults / denies—verify in `admin-tab-gates` route when operating).
- **Team-scoped data** (teams collection, ownership): `getUserTeamIds` and similar helpers catch errors and may return empty lists—can narrow access or break features; do not assume elevated access.
- **RAG**: if team ownership lookup cannot run where required, spec requires **fail closed** for query filtering (FR-027)—see RAG `rbac.py` implementation.

### 5.4 CEL evaluation errors (BFF)

- `cel-evaluator.ts`: parse/runtime errors → **false** (deny).

---

## 6. Bootstrap admin (`BOOTSTRAP_ADMIN_EMAILS`)

- **Purpose**: Comma-separated list of emails treated as **admin** on login when IdP group → role mapping is not yet configured.
- **Implementation**: `ui/src/lib/auth-config.ts` (`isBootstrapAdmin`), also used from `getAuthenticatedUser` / `requireRbacPermission` role fallback for `admin_ui` when email matches.
- **Operational guidance**: Remove or empty the variable after realm roles and group mappers are correct; it is a **break-glass bootstrap**, not a long-term RBAC model.

---

## 7. Environment variables (CAIPE UI / BFF)

Copy from **`ui/.env.example`** and **`ui/env.example`** into `.env.local`. Below is a consolidated **name + description** list (no secret values).

### OIDC / NextAuth

| Variable | Description |
|----------|-------------|
| `NEXTAUTH_SECRET` | NextAuth session encryption secret |
| `NEXTAUTH_URL` | Public base URL of the UI (callbacks) |
| `NEXT_PUBLIC_SSO_ENABLED` | Enable SSO UI paths (`true`/`false`) |
| `OIDC_ISSUER` | Keycloak realm issuer URL |
| `OIDC_CLIENT_ID` | OIDC client (typically `caipe-ui`) |
| `OIDC_CLIENT_SECRET` | Client secret |
| `OIDC_REQUIRED_GROUP` | Optional: require group membership to use app |
| `OIDC_REQUIRED_ADMIN_GROUP` | Optional: map matching **realm role name** in token to admin session role |
| `OIDC_GROUP_CLAIM` | Optional: claim name(s) for groups |
| `OIDC_ENABLE_REFRESH_TOKEN` | Optional: disable refresh if IdP lacks `offline_access` |

### Keycloak Admin API — UI BFF (FR-024)

Used by the Next.js BFF (`ui/src/lib/rbac/keycloak-admin.ts`) for role-mapping CRUD, IdP config, etc. Reads in this order:

1. `client_credentials` grant against the `caipe` realm using `KEYCLOAK_ADMIN_CLIENT_ID` + `KEYCLOAK_ADMIN_CLIENT_SECRET` (when both are non-empty).
2. Otherwise falls back to the `master` realm `password` grant with hardcoded `admin-cli`/`admin`/`admin` (dev only).

| Variable | Description |
|----------|-------------|
| `KEYCLOAK_URL` | Keycloak base URL |
| `KEYCLOAK_REALM` | Realm name (`caipe`) |
| `KEYCLOAK_ADMIN_CLIENT_ID` | UI BFF admin client (`admin-cli` dev or dedicated client prod) |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Optional; empty triggers password grant in dev (see `.env.example`) |

### Keycloak Admin API — Slack bot (FR-025 identity lookup)

Used by `ai_platform_engineering/integrations/slack_bot/utils/keycloak_admin.py` to find a Keycloak user by `slack_user_id` user attribute and read/write `team_id`. Always uses `client_credentials` against the `caipe` realm — there is no password fallback.

The client referenced here MUST be **confidential** and have these realm-management roles: `view-users`, `query-users` (and `manage-users` if you also use the bot to set attributes).

| Variable | Description |
|----------|-------------|
| `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID` | Slack bot's admin client. Default `caipe-platform` (the realm seeder grants the required roles). Do NOT set this to `admin-cli` — it's a public client and rejects `client_credentials` with HTTP 401. |
| `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET` | Matching client_secret. In dev, defaults to `caipe-platform-dev-secret`. |

> **Why a separate name from `KEYCLOAK_ADMIN_*`, and why include the surface name?** Pre-098 the slack-bot read the same `KEYCLOAK_ADMIN_*` vars as the UI. A single `KEYCLOAK_ADMIN_CLIENT_ID=admin-cli` line in `.env` (intended for the UI's password-grant fallback) would silently override the slack-bot's client_credentials path, producing `HTTP 401 "Public client not allowed to retrieve service account"` on every Slack mention. The surface-specific `KEYCLOAK_SLACK_BOT_ADMIN_*` names eliminate that namespace collision permanently and leave room for future bot surfaces — e.g. `KEYCLOAK_WEBEX_BOT_ADMIN_*`, `KEYCLOAK_TEAMS_BOT_ADMIN_*` — without another rename.

### Keycloak Authorization Services client (UMA checks)

| Variable | Description |
|----------|-------------|
| `KEYCLOAK_RESOURCE_SERVER_ID` | Audience / resource server client id (default `caipe-platform`) |
| `KEYCLOAK_CLIENT_SECRET` | Secret for **`caipe-platform`** when required by your token exchange / setup |

### RBAC / CEL (BFF)

| Variable | Description |
|----------|-------------|
| `RBAC_CACHE_TTL_SECONDS` | TTL for permission decision cache (default 60; 0 disables) |
| `CEL_RBAC_EXPRESSIONS` | JSON map `resource#scope` → CEL string for supplementary checks |

### Bootstrap

| Variable | Description |
|----------|-------------|
| `BOOTSTRAP_ADMIN_EMAILS` | Comma-separated emails with bootstrap admin |

### Data / URLs

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` / `MONGODB_DATABASE` | MongoDB connection and DB name |
| `NEXT_PUBLIC_MONGODB_ENABLED` | Client hint for Mongo mode |
| `NEXT_PUBLIC_CAIPE_URL` / `NEXT_PUBLIC_A2A_BASE_URL` | Supervisor / A2A base URL |
| `NEXT_PUBLIC_RAG_URL` | RAG server URL |

### Feature flags (admin tabs, audit, tickets, …)

See `ui/src/lib/config.ts` for full list: e.g. `FEEDBACK_ENABLED`, `NPS_ENABLED`, `AUDIT_LOGS_ENABLED`, `ACTION_AUDIT_ENABLED`, `REPORT_PROBLEM_ENABLED`, ticket integration vars, workflow runner, etc.

### Slack linking (BFF)

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Used by BFF to post Slack DM after identity link (FR-025) |

Docker Compose may set additional names (`KEYCLOAK_BOT_CLIENT_*` for bot, etc.)—see `docker-compose.dev.yaml` for the slack-bot and caipe-ui services.

---

## Related documents

- [permission-matrix.md](./permission-matrix.md) — FR-008 / FR-014 capability matrix  
- [security-review.md](./security-review.md) — verification checklist  
- [quickstart.md](./quickstart.md) — local bring-up  
- [spec.md](./spec.md) — normative requirements  
