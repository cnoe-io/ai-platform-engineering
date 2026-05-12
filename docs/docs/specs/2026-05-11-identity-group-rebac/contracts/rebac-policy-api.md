# Contract: Universal ReBAC Policy API

## Scope

These BFF endpoints expose guided relationship authoring, graph visualization, tuple inspection, and access checking across all CAIPE resource types. Raw OpenFGA access remains server-side only; clients interact through validated CAIPE resource and relationship contracts.

## Authorization

- All endpoints require an authenticated session.
- Read endpoints require `read` on the OpenFGA/ReBAC admin surface or a scoped relationship to the requested resource.
- Write endpoints require `manage` on the target resource or delegated policy scope.
- Access checker requests can be limited to the caller's subject unless the caller has audit/admin permission.

## Resource Reference

```json
{
  "type": "agent",
  "id": "platform-engineer",
  "display_name": "Platform Engineer"
}
```

Supported resource types include:

- `organization`
- `user`
- `external_group`
- `team`
- `slack_workspace`
- `slack_channel`
- `agent`
- `mcp_server`
- `tool`
- `knowledge_base`
- `document`
- `skill`
- `task`
- `conversation`
- `admin_surface`
- `policy`
- `audit_view`
- `secret_reference`
- `system_config`

## Relationship Request

```json
{
  "subject": {
    "type": "team",
    "id": "platform",
    "relation": "member"
  },
  "action": "use",
  "resource": {
    "type": "agent",
    "id": "platform-engineer"
  },
  "source": {
    "type": "manual",
    "id": "change-set-123"
  }
}
```

## Endpoints

### `GET /api/admin/rebac/catalog`

Returns all resources visible to the caller for policy authoring.

**Query**

- `type`: optional resource type filter.
- `team`: optional team scope.
- `status`: optional status filter.
- `search`: optional display-name search.

**Response**

```json
{
  "resources": [
    {
      "type": "agent",
      "id": "platform-engineer",
      "display_name": "Platform Engineer",
      "status": "active",
      "enforcement_status": "rebac_enforced"
    }
  ],
  "actions": {
    "agent": ["discover", "read", "use", "manage", "invoke"],
    "tool": ["discover", "read", "use", "manage", "call"]
  }
}
```

### `POST /api/admin/rebac/change-sets`

Creates a staged set of relationship grants and revocations.

**Request**

```json
{
  "description": "Grant platform team access to Slack channel resources",
  "grants": [
    {
      "subject": { "type": "team", "id": "platform", "relation": "member" },
      "action": "use",
      "resource": { "type": "agent", "id": "platform-engineer" }
    }
  ],
  "revocations": []
}
```

**Response**

```json
{
  "change_set_id": "change-set-123",
  "status": "validating",
  "validation": {
    "allowed": true,
    "warnings": [],
    "blocked_changes": []
  }
}
```

### `POST /api/admin/rebac/change-sets/{change_set_id}/validate`

Validates the staged change set for relationship shape, delegated admin scope, circular grants, and unsafe revocations.

### `POST /api/admin/rebac/change-sets/{change_set_id}/apply`

Writes validated relationships to OpenFGA and records provenance in MongoDB.

**Response**

```json
{
  "change_set_id": "change-set-123",
  "status": "applied",
  "applied": {
    "grants": 1,
    "revocations": 0
  }
}
```

### `GET /api/admin/rebac/graph`

Returns graph nodes and edges for a scope.

**Query**

- `scope`: `all`, `team`, `resource`, `subject`, or `slack_channel`.
- `scope_id`: required unless scope is `all`.
- `limit`: maximum edge count.
- `cursor`: pagination cursor.

**Response**

```json
{
  "nodes": [
    {
      "id": "team:platform#member",
      "type": "team",
      "label": "Platform members"
    },
    {
      "id": "agent:platform-engineer",
      "type": "agent",
      "label": "Platform Engineer"
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "from": "team:platform#member",
      "to": "agent:platform-engineer",
      "relation": "can_use",
      "source_type": "manual"
    }
  ],
  "truncated": false,
  "next_cursor": null
}
```

### `POST /api/admin/rebac/check`

Checks and explains an access decision.

**Request**

```json
{
  "subject": {
    "type": "user",
    "id": "user-123"
  },
  "action": "use",
  "resource": {
    "type": "agent",
    "id": "platform-engineer"
  },
  "context": {
    "slack_channel": "C123"
  }
}
```

**Response**

```json
{
  "allowed": true,
  "decision": "allow",
  "checked_at": "2026-05-11T00:00:00Z",
  "explanation": {
    "path": [
      "user:user-123 member of team:platform",
      "team:platform#member can_use agent:platform-engineer"
    ],
    "policy_sources": ["manual:change-set-123"]
  }
}
```

### `GET /api/admin/rebac/resources/{type}/{id}/relationships`

Returns active and staged relationships for a resource.

### `GET /api/admin/rebac/enforcement-status`

Reports which resource types and runtime surfaces are not gated, role-gated, shadowed, or ReBAC-enforced.

## Errors

- `400`: unsupported resource type/action, malformed subject, or invalid graph scope.
- `403`: caller cannot inspect or mutate the requested scope.
- `409`: change set stale, unsafe last-admin revocation, or conflicting relationship ownership.
- `422`: relationship shape valid but unsupported by the OpenFGA model.
