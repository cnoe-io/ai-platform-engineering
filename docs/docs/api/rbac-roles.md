---
sidebar_position: 3
---

# RBAC & Roles API

Swagger-style reference for CAIPE UI UI Backend API routes that manage **Keycloak realm roles**, **IdP group → role mappings**, **authorization policies** (MongoDB + CEL), **RBAC audit** (MongoDB), and **current-user** role/permission introspection.

All paths are relative to the Next.js app (typically `/api/...`). Unless noted, responses from `withErrorHandler` + `successResponse` use the envelope `{ "success": true, "data": ... }`. Errors use `{ "success": false, "error": "...", "code": "..." }` when thrown as `ApiError`.

---

## RBAC model (overview)

### Keycloak realm roles

Platform roles are assigned in Keycloak (often via IdP group mappers). Common built-in / protected names include:

- **`admin`** — Full admin; OIDC group or MongoDB `users.metadata.role === "admin"` can elevate the UI Backend API session.
- **`chat_user`** — Standard chat user.
- **`team_member`** — Team-scoped collaboration.
- **`kb_admin`** — Knowledge-base administration (global; complements per-KB roles).
- **`offline_access`**, **`uma_authorization`**, **`default-roles-<realm>`** — Keycloak/OIDC plumbing; listed by the admin roles API and **must not** be deleted via the UI Backend API.

The UI Backend API also recognizes **`denied`** in type definitions for explicit lockout scenarios.

### Per-KB roles

Fine-grained KB access uses realm role **name conventions** (JWT `realm_access.roles`):

| Pattern | Purpose |
|---------|---------|
| `kb_reader:<kb-id>` | Read/query a specific KB |
| `kb_ingestor:<kb-id>` | Ingest into a specific KB |
| `kb_admin:<kb-id>` | Full admin for that KB |

Wildcards such as `kb_reader:*` may be used where policy allows. Global `admin` / `kb_admin` typically bypass per-KB checks downstream (RAG server + team ownership from MongoDB).

### Per-agent roles

Dynamic agent access combines Keycloak resources/scopes with realm roles:

| Pattern | Purpose |
|---------|---------|
| `agent_user:<agent-id>` | Use (view/invoke) a specific agent |
| `agent_admin:<agent-id>` | Configure/delete that agent |

Wildcards like `agent_user:*` may apply platform-wide at that scope per deployment policy.

### CEL policy evaluation layer

After Keycloak Authorization Services (UMA ticket, **PDP-1**) grants a permission, optional **CEL** expressions from `CEL_RBAC_EXPRESSIONS` (JSON map of `resource#scope` → expression) can **deny** access (`DENY_CEL`, HTTP 403 `"Policy denied (CEL)"`). Context includes JWT-derived `user.roles`, resource metadata, and action. This is defense-in-depth on top of Keycloak policies and realm roles.

### Keycloak AuthZ resources & scopes

Typed resources include `admin_ui`, `slack`, `supervisor`, `rag`, `sub_agent`, `tool`, `skill`, `a2a`, `mcp`. Scopes include `view`, `create`, `update`, `delete`, `invoke`, `admin`, `configure`, `ingest`, `query`, `audit.view`, `kb.admin`, `kb.ingest`, `kb.query`, and tool-specific scopes. The **permissions** endpoint returns effective `resource → [scopes]` from an RPT (`response_mode=permissions`).

---

## Realm Roles (CRUD)

### `GET /api/admin/roles`

**Auth:** Session (admin) | **Since:** v1.0

Lists all **realm roles** in the configured Keycloak realm via the Admin REST API. Caller must have UI Backend API **admin** role (OIDC or MongoDB fallback).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:** None.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "roles": [
      {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "name": "admin",
        "description": "Platform administrators",
        "composite": false,
        "clientRole": false,
        "containerId": "caipe"
      },
      {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "name": "kb_reader:platform-docs",
        "description": "Read access to platform-docs KB",
        "composite": false,
        "clientRole": false,
        "containerId": "caipe"
      }
    ],
    "total": 2
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | _(none)_ | No valid session (`Unauthorized`). |
| 403 | _(none)_ | Not admin (`Admin access required - must be member of admin group`). |
| 500 | _(none)_ | Keycloak admin token or list failure (message from handler). |

---

### `POST /api/admin/roles`

**Auth:** Session (admin) | **Since:** v1.0

Creates a new **realm role** in Keycloak.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:**

```json
{
  "name": "custom_support",
  "description": "Optional human-readable description"
}
```

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "message": "Role created successfully",
    "name": "custom_support"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | _(none)_ | Missing or empty `name` (`Role name is required`). |
| 401 | _(none)_ | No valid session. |
| 403 | _(none)_ | Not admin. |
| 500 | _(none)_ | Keycloak create failed (e.g. duplicate role). |

---

### `GET /api/admin/roles/{name}`

**Auth:** Session (admin) | **Since:** v1.0

Returns a single realm role by **name**. `{name}` is URL-encoded (e.g. `kb_reader%3Aplatform-docs`).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:** None.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "role": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "admin",
      "description": "Platform administrators",
      "composite": false,
      "clientRole": false,
      "containerId": "caipe"
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | _(none)_ | No valid session. |
| 403 | _(none)_ | Not admin. |
| 404 | _(none)_ | Role not found. |
| 500 | _(none)_ | Keycloak error. |

---

### `DELETE /api/admin/roles/{name}`

**Auth:** Session (admin) | **Since:** v1.0

Deletes a realm role by name. **Built-in roles** cannot be deleted: `admin`, `chat_user`, `team_member`, `kb_admin`, `offline_access`, `uma_authorization`, `default-roles-caipe`.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:** None.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "message": "Role deleted successfully"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | _(none)_ | Target is a built-in role (`Cannot delete built-in role`). |
| 401 | _(none)_ | No valid session. |
| 403 | _(none)_ | Not admin. |
| 500 | _(none)_ | Keycloak delete error. |

---

## Role Mappings (IdP group to role)

### `GET /api/admin/role-mappings`

**Auth:** Session (admin) | **Since:** v1.0

Lists all identity providers and their **OIDC mappers**, flattened with an `idpAlias` field on each mapper for UI use.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:** None.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "mappers": [
      {
        "id": "mapper-uuid-1",
        "name": "duo-sso-engineering-to-team_member",
        "identityProviderAlias": "duo-sso",
        "identityProviderMapper": "oidc-advanced-role-idp-mapper",
        "config": {
          "syncMode": "INHERIT",
          "are.claim.values.regex": "false",
          "claims": "[{\"key\":\"groups\",\"value\":\"engineering\"}]",
          "role": "team_member"
        },
        "idpAlias": "duo-sso"
      }
    ],
    "idpAliases": [
      {
        "alias": "duo-sso",
        "displayName": "Duo SSO",
        "providerId": "oidc"
      }
    ]
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | _(none)_ | No valid session. |
| 403 | _(none)_ | Not admin. |
| 500 | _(none)_ | Keycloak admin API failure. |

---

### `POST /api/admin/role-mappings`

**Auth:** Session (admin) | **Since:** v1.0

Creates an **OIDC advanced role IdP mapper** that assigns a **realm role** when the IdP token’s `groups` claim contains an exact group name.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:**

```json
{
  "idpAlias": "duo-sso",
  "groupName": "platform-admins",
  "roleName": "admin"
}
```

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "id": "new-mapper-uuid",
    "name": "duo-sso-platform-admins-to-admin",
    "identityProviderAlias": "duo-sso",
    "identityProviderMapper": "oidc-advanced-role-idp-mapper",
    "config": {
      "syncMode": "INHERIT",
      "are.claim.values.regex": "false",
      "claims": "[{\"key\":\"groups\",\"value\":\"platform-admins\"}]",
      "role": "admin"
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | _(none)_ | Invalid or empty `idpAlias`, `groupName`, or `roleName`. |
| 401 | _(none)_ | No valid session. |
| 403 | _(none)_ | Not admin. |
| 500 | _(none)_ | Keycloak mapper creation failed. |

---

### `DELETE /api/admin/role-mappings/{id}`

**Auth:** Session (admin) | **Since:** v1.0

Deletes an IdP mapper by **mapper id** and **IdP alias** (query param).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `alias` | string | **Yes** | Identity provider alias (e.g. `duo-sso`). |

**Request Body:** None.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "ok": true
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | _(none)_ | Missing `alias` (`alias query parameter is required`). |
| 401 | _(none)_ | No valid session. |
| 403 | _(none)_ | Not admin. |
| 500 | _(none)_ | Keycloak delete failed. |

---

## RBAC Permissions (current user)

### `GET /api/rbac/permissions`

**Auth:** Session with access token | **Since:** v1.0

Returns the caller’s **effective Keycloak Authorization permissions** as a map of resource name → scope list (from UMA ticket grant with `response_mode=permissions`). Used for capability-based UI (e.g. `useRbacPermissions`). Does **not** use the `success` / `data` envelope.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:** None.

**Response `200`:**

```json
{
  "permissions": {
    "admin_ui": ["view", "audit.view"],
    "rag": ["kb.query", "kb.ingest"],
    "supervisor": ["invoke"]
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | _(none)_ | `{ "error": "Unauthorized" }` — no session or no `accessToken`. |
| 503 | _(none)_ | `{ "error": "Failed to retrieve permissions" }` — Keycloak or network failure. |

---

### `GET /api/auth/role`

**Auth:** Optional session | **Since:** v1.0

Returns a coarse **UI role** string: `admin` or `user` (default). Uses `session.role` from OIDC; if not `admin`, may promote to `admin` when MongoDB `users` has `metadata.role === "admin"`. **Unauthenticated** callers still receive `200` with `role: "user"` (no email).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:** None.

**Response `200` (authenticated):**

```json
{
  "role": "admin",
  "email": "alice@example.com"
}
```

**Response `200` (no session):**

```json
{
  "role": "user"
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| _(rare)_ | 500 | MongoDB errors are logged; response typically still `200` with OIDC-derived role. |

---

## Authorization Policies

### `GET /api/policies`

**Auth:** Session (admin view) | **Since:** v1.0

Loads the **default** named policy document (`name: "default"`) from MongoDB. Requires authentication (all authenticated users can read). Requires MongoDB.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:** None.

**Response `200` (document exists):**

```json
{
  "success": true,
  "data": {
    "name": "default",
    "content": "# CEL / policy rules...\npackage caipe\n...",
    "is_system": true,
    "updated_at": "2026-03-25T12:00:00.000Z",
    "updated_by": "alice@example.com",
    "exists": true
  }
}
```

**Response `200` (no document yet):**

```json
{
  "success": true,
  "data": {
    "name": "default",
    "content": "",
    "is_system": true,
    "exists": false
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | _(none)_ | No valid session. |
| 403 | _(none)_ | Not authenticated. |
| 503 | _(none)_ | MongoDB not configured. |
| 500 | _(none)_ | Unexpected error. |

---

### `PUT /api/policies`

**Auth:** Session (admin) | **Since:** v1.0

Upserts the **default** policy body in MongoDB. Requires MongoDB.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:**

```json
{
  "content": "# Updated policy logic\npackage caipe\n..."
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "message": "Policy updated successfully"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | _(none)_ | `content` missing or not a string. |
| 401 | _(none)_ | No valid session. |
| 403 | _(none)_ | Not admin. |
| 503 | _(none)_ | MongoDB not configured. |

---

### `POST /api/policies`

**Auth:** Session (admin) | **Since:** v1.0

**Reset** default policy from the first readable **`policy.lp`** on disk (seed paths: `POLICY_SEED_PATH`, `/app/policy.lp`, `./policy.lp`, etc.). Query parameter **`action=reset`** is required.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | **Yes** | Must be `reset`. |

**Request Body:** None.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "message": "Policy reset to default from file"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | _(none)_ | `action` not `reset` (`Only action=reset is supported`). |
| 401 | _(none)_ | No valid session. |
| 403 | _(none)_ | Not admin. |
| 404 | _(none)_ | No `policy.lp` found on disk. |
| 503 | _(none)_ | MongoDB not configured. |

---

### `GET /api/policies/seed`

**Auth:** Session (authenticated) | **Since:** v1.0

If no **`default`** policy exists in MongoDB, inserts one from the first found **`policy.lp`** file. If a default policy already exists, returns without changing data. Requires MongoDB.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Request Body:** None.

**Response `200` (seeded):**

```json
{
  "success": true,
  "data": {
    "seeded": true,
    "message": "Seeded default policy from /app/policy.lp"
  }
}
```

**Response `200` (already present):**

```json
{
  "success": true,
  "data": {
    "seeded": false,
    "message": "Default policy already exists"
  }
}
```

**Response `200` (no file):**

```json
{
  "success": true,
  "data": {
    "seeded": false,
    "message": "No policy.lp found. Set POLICY_SEED_PATH or mount at /app/policy.lp"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | _(none)_ | No valid session. |
| 503 | _(none)_ | MongoDB not configured. |

---

## RBAC Audit

### `GET /api/admin/rbac-audit`

**Auth:** Session + Keycloak permission `admin_ui#audit.view` | **Since:** v1.0

Reads paginated **authorization decision** records from MongoDB collection `authorization_decision_records`. Uses `getServerSession` and `requireRbacPermission` (Keycloak UMA **decision** mode, then optional CEL). Scoped by `session.org` as `tenant_id` when present. Response is **plain JSON** (no `success` / `data` wrapper).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | string (ISO 8601) | No | Start of time range; default **now − 24h**. |
| `to` | string (ISO 8601) | No | End of time range; default **now**. |
| `component` | string | No | Filter by component (`admin_ui`, `rag`, `supervisor`, …). |
| `capability` | string | No | Filter by capability string. |
| `subject_hash` | string | No | Filter by subject hash. |
| `outcome` | string | No | `allow` or `deny` (case-insensitive). |
| `page` | integer | No | Page number, default `1`, must be ≥ 1. |
| `limit` | integer | No | Page size, default `50`, **1–200**. |

**Request Body:** None.

**Response `200`:**

```json
{
  "records": [
    {
      "ts": "2026-03-25T14:30:00.000Z",
      "tenant_id": "org-123",
      "subject_hash": "sha256:abcd...",
      "actor_hash": "sha256:ef01...",
      "capability": "admin_ui#audit.view",
      "component": "admin_ui",
      "resource_ref": "/api/admin/rbac-audit",
      "outcome": "allow",
      "reason_code": "OK",
      "pdp": "keycloak",
      "correlation_id": "req-9f3c2a1b"
    },
    {
      "ts": "2026-03-25T14:29:55.000Z",
      "tenant_id": "org-123",
      "subject_hash": "sha256:abcd...",
      "capability": "rag#kb.query",
      "component": "rag",
      "outcome": "deny",
      "reason_code": "DENY_NO_CAPABILITY",
      "pdp": "keycloak",
      "correlation_id": "req-8e2b1a0c"
    }
  ],
  "total": 1240,
  "page": 1,
  "limit": 50
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid ISO dates, `from` > `to`, bad `outcome`, or invalid `page` / `limit`. |
| 401 | _(none)_ | No session or missing email; missing `accessToken` (`Authentication required`). |
| 403 | `admin_ui#audit.view` | Keycloak denied (`You do not have permission to perform this action.`). |
| 403 | `CEL_DENIED` | CEL policy denied (`Policy denied (CEL)`). |
| 503 | _(none)_ | MongoDB not configured (`MONGODB_NOT_CONFIGURED` body) or PDP unavailable (`Authorization service unavailable — access denied (fail-closed)`). |
| 500 | _(none)_ | Unhandled server error. |

---

## `GET /api/admin/audit-events` — Unified Audit Events (FR-037)

Paginated query across **all** audit event types (auth decisions, tool actions, agent delegations) stored in the `audit_events` MongoDB collection.

**Auth:** Requires valid session + `requireRbacPermission(admin_ui, audit.view)`.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `auth` \| `tool_action` \| `agent_delegation` | _(all)_ | Filter by event type. |
| `from` | ISO 8601 | `-24h` | Start of date range. |
| `to` | ISO 8601 | `now` | End of date range. |
| `outcome` | `allow` \| `deny` \| `success` \| `error` | _(all)_ | Filter by outcome. |
| `agent_name` | string | _(all)_ | Filter by agent name (exact match). |
| `tool_name` | string | _(all)_ | Filter by tool name (exact match). |
| `user_email` | string | _(all)_ | Filter by user email (case-insensitive substring). |
| `component` | string | _(all)_ | Filter by component (e.g., `admin_ui`, `supervisor`). |
| `correlation_id` | string | _(all)_ | Filter by correlation / trace id. |
| `page` | integer ≥ 1 | `1` | Page number. |
| `limit` | 1–200 | `50` | Results per page. |

**Response (200):**

```json
{
  "records": [
    {
      "ts": "2026-03-25T18:30:00.000Z",
      "type": "tool_action",
      "tenant_id": "default",
      "subject_hash": "sha256:abc123...",
      "user_email": "alice@example.com",
      "action": "argocd_list_applications",
      "agent_name": "argocd",
      "tool_name": "argocd_list_applications",
      "outcome": "success",
      "duration_ms": 1234.56,
      "correlation_id": "trace-abc-def",
      "context_id": "conv-123",
      "component": "argocd",
      "source": "supervisor"
    }
  ],
  "total": 500,
  "page": 1,
  "limit": 50
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid filter values (`type`, `outcome`, dates, `page`, `limit`). |
| 401 | _(none)_ | No session or missing email. |
| 403 | `admin_ui#audit.view` | Keycloak / RBAC denied. |
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB not configured. |

---

## Admin tab visibility (CEL)

Admin UI tabs can be gated by **CEL expressions** stored in MongoDB collection `admin_tab_policies`. Evaluated context includes `user.email`, `user.roles` (JWT `realm_access.roles` plus session/bootstrap admin), and `user.teams` (currently often empty in this path). Feature flags (`feedbackEnabled`, `npsEnabled`, `auditLogsEnabled`, `actionAuditEnabled`) are **AND**ed with CEL for the corresponding tabs.

### `GET /api/rbac/admin-tab-gates`

**Description:** Returns `{ gates: Record<tab_key, boolean> }` for all known admin tabs (`users`, `teams`, `roles`, `slack`, `skills`, `feedback`, `nps`, `stats`, `metrics`, `health`, `audit_logs`, `action_audit`, `policy`).

**Authorization:** Valid NextAuth session with `user.email`. Unauthenticated → `401`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| _(none)_ | — | — | — |

**Response** (`200`):

```json
{
  "gates": {
    "users": true,
    "roles": false,
    "slack": false
  }
}
```

**Errors:**

| Code | Description |
|------|-------------|
| `401` | `{ "error": "Unauthorized" }` |

**Notes:** If MongoDB is unavailable, default policies from code are used for evaluation. Missing tab keys are back-filled from defaults on first read.

---

### `PUT /api/rbac/admin-tab-gates`

**Description:** Upserts one CEL expression for a tab. Body is validated with a dry-run evaluation before persist.

**Authorization:** `session.role === "admin"` (NextAuth coarse admin). Not Keycloak UMA.

**Parameters (JSON body):**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab_key` | string | Yes | One of the known tab keys (see GET). |
| `expression` | string | Yes | CEL expression (e.g. `'admin' in user.roles`). |

**Response** (`200`):

```json
{
  "success": true,
  "tab_key": "stats",
  "expression": "'admin' in user.roles"
}
```

**Errors:**

| Code | Description |
|------|-------------|
| `400` | Invalid JSON, missing fields, unknown `tab_key`, or invalid CEL |
| `401` | Not signed in |
| `403` | `{ "error": "Admin access required" }` |
| `500` | MongoDB update failure |

---

### `GET /api/rbac/admin-tab-policies`

**Description:** Returns raw stored policies for the Policy tab editor: `tab_key`, `expression`, `updated_by`, `updated_at`.

**Authorization:** `session.role === "admin"` + MongoDB configured.

**Response** (`200`):

```json
{
  "policies": [
    {
      "tab_key": "users",
      "expression": "true",
      "updated_by": "alice@example.com",
      "updated_at": "2026-03-25T12:00:00.000Z"
    }
  ]
}
```

**Errors:**

| Code | Description |
|------|-------------|
| `401` | Not signed in |
| `403` | Not admin |
| `503` | `{ "error": "MongoDB not configured" }` |
| `500` | Database error |

---

## Related implementation

| Area | Location |
|------|----------|
| Realm roles & IdP mappers | `ui/src/lib/rbac/keycloak-admin.ts` |
| Permission check & effective permissions | `ui/src/lib/rbac/keycloak-authz.ts` |
| Types (`RbacResource`, `RbacScope`, audit) | `ui/src/lib/rbac/types.ts` |
| Session, admin gates, `requireRbacPermission` | `ui/src/lib/api-middleware.ts` |
| Python audit logger (supervisor) | `ai_platform_engineering/utils/audit_logger.py` |
| Python audit callback handler | `ai_platform_engineering/utils/audit_callback.py` |
| BFF dual-write (auth → audit_events) | `ui/src/lib/rbac/audit.ts` |
| Unified audit API route | `ui/src/app/api/admin/audit-events/route.ts` |
| Admin tab CEL gates / policies | `ui/src/app/api/rbac/admin-tab-gates/route.ts`, `ui/src/app/api/rbac/admin-tab-policies/route.ts` |
| Unified audit UI component | `ui/src/components/admin/UnifiedAuditTab.tsx` |
