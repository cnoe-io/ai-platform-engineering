# Contract: HTTP API Changes

All routes are Next.js BFF routes under `ui/src/app/api/`. Existing auth
middleware (`requireRbacPermission`, `requireResourcePermission`) is reused.

## A1. Datasource sharing — extend existing route

`GET /api/rag/kbs/[id]/sharing`

- **Change**: response `owner_team_slug` MUST be the real owner from the
  persisted datasource config (today it is always `null`). Add
  `creator_subject` (read-only) for display/audit.
- Response:
  ```json
  {
    "knowledge_base_id": "string",
    "owner_team_slug": "string | null",
    "shared_team_slugs": ["string"],
    "creator_subject": "string | null"
  }
  ```
- Gate unchanged: `knowledge_base#read`, `bypassForOrgAdmin: true`.

`PUT /api/rag/kbs/[id]/sharing`

- **Change**: accepts optional `owner_team_slug` (create/first-set only — NOT a
  transfer; rejected if it would change an existing owner). Persists owner +
  shared to the datasource config and reconciles via the shared helper.
- Request: `{ "team_slugs": ["string"], "owner_team_slug": "string?" }`
- Gate unchanged: `knowledge_base#admin`, `bypassForOrgAdmin: true`.

## A2. Datasource creation — capture owner + creator

The datasource create path (BFF proxy on `POST v1/datasource`) MUST:

- accept `owner_team_slug` from the request body (already partially wired),
- capture `creator_subject = session.sub`,
- persist all four mixin fields to the datasource config,
- write the `parent_kb` edge and owner/creator tuples on upstream success.

## A3. Ownership transfer — new capability

A transfer is expressed as `owner_team_slug` change on a dedicated path or an
explicit `?transfer=true` form of the sharing PUT (implementation choice). It:

- **Authorization**: caller is current owner-team admin (`can_manage`) OR org
  admin. Otherwise `403`.
- **Request**: `{ "owner_team_slug": "string", "confirm_not_member": boolean? }`
- **Behavior**: reconcile with `previousOwnerTeamSlug = <stored owner>`,
  `ownerTeamSlug = <new>`, `allowOwnerTransfer: true`; persist new owner.
- **Response**: `{ "owner_team_slug": "string", "reconcile": { ... } }`
- `creator` tuple unchanged.

Applies uniformly to agents, datasources, and MCP tools (same helper).

## A4. Custom MCP tool — create/update/delete

`POST /v1/mcp/custom-tools` (via BFF proxy)

- Capture `creator_subject`, `owner_team_slug`, `shared_with_teams` from body;
  validate owner-team membership; persist to `MCPToolConfig`; reconcile on
  upstream success.

`PUT /v1/mcp/custom-tools/[tool_id]` (via BFF proxy)

- Read previous owner/shared from config; reconcile diff; persist; owner change
  only via transfer path (A3).

`DELETE /v1/mcp/custom-tools/[tool_id]` (via BFF proxy)

- **New**: after upstream delete succeeds, remove ALL `mcp_tool:<id>` grants
  (owner, shared, creator) so no orphan tuples remain (FR-028).

## A5. MCP tool invocation enforcement — new gate

The BFF invocation path that forwards to `/v1/mcp/invoke` MUST, before
forwarding:

- resolve the target `mcp_tool:<id>` (custom tools only),
- `Check(<principal>, can_call, mcp_tool:<id>)` where `<principal>` is the
  session user (`user:<sub>`) or, for agent-initiated calls, `agent:<id>`,
- deny with a tool-specific `403` if the check fails (FR-029).

Built-in tools and non-custom tool names are out of scope for this gate (no
`mcp_tool` object exists for them).

## A6. Error and status conventions (unchanged)

- `400` invalid id / body (existing `INVALID_*` codes).
- `401` no session / no access token.
- `403` failed resource permission (existing `FORBIDDEN`).
- Reconcile failures are logged and surfaced in the response `reconcile` field;
  they do not 500 the config write (config remains source of truth).
