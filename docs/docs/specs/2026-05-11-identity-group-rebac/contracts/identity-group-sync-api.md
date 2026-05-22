# Contract: Identity Group Sync Admin API

## Scope

These BFF endpoints support provider health, regex mapping clusters, dry-run previews, applied sync runs, external group links, membership source review, and skipped-user remediation. All endpoints require authenticated admin access and must additionally pass ReBAC checks for the relevant admin surface and provider/team scope.

## Authorization

- Global RBAC administrators can view and manage all sync providers and rules.
- Scoped team administrators can view sync-derived membership for teams they administer but cannot create provider-wide mapping rules unless delegated.
- Dry-run execution requires `use` on the identity sync admin surface.
- Applying changes requires `manage` on the identity sync admin surface and `manage` on affected team resources.

## Endpoints

### `GET /api/admin/identity-group-sync/providers`

Returns configured identity sources and health status.

**Response**

```json
{
  "providers": [
    {
      "id": "okta-primary",
      "type": "okta",
      "display_name": "Okta",
      "status": "healthy",
      "capabilities": ["list_groups", "list_group_members", "immutable_group_ids"],
      "last_checked_at": "2026-05-11T00:00:00Z"
    }
  ]
}
```

### `GET /api/admin/identity-group-sync/rules`

Lists mapping clusters.

**Query**

- `provider_id`: optional provider filter.
- `status`: optional rule status filter.

**Response**

```json
{
  "rules": [
    {
      "id": "rule-platform-teams",
      "provider_id": "okta-primary",
      "name": "Platform teams",
      "priority": 10,
      "enabled": true,
      "review_status": "enabled",
      "include_patterns": ["^CAIPE-(?<team>[A-Za-z0-9-]+)-(?<role>Members|Admins)$"],
      "exclude_patterns": ["^CAIPE-Experimental-"],
      "team_slug_template": "${team}",
      "role_map": {
        "Members": "member",
        "Admins": "admin"
      },
      "auto_create_team": true
    }
  ]
}
```

### `POST /api/admin/identity-group-sync/rules`

Creates a draft mapping cluster. Saving a rule does not enable writes until a dry-run has been reviewed.

**Request**

```json
{
  "provider_id": "okta-primary",
  "name": "Platform teams",
  "priority": 10,
  "include_patterns": ["^CAIPE-(?<team>[A-Za-z0-9-]+)-(?<role>Members|Admins)$"],
  "exclude_patterns": ["^CAIPE-Experimental-"],
  "team_name_template": "${team}",
  "team_slug_template": "${team}",
  "role_map": {
    "Members": "member",
    "Admins": "admin"
  },
  "auto_create_team": true
}
```

**Response**

```json
{
  "rule": {
    "id": "rule-platform-teams",
    "review_status": "dry_run_required"
  }
}
```

### `PATCH /api/admin/identity-group-sync/rules/{rule_id}`

Updates a mapping cluster. Material edits move enabled rules back to `dry_run_required`.

**Request**

```json
{
  "enabled": false,
  "priority": 20,
  "exclude_patterns": ["^CAIPE-Experimental-", "^CAIPE-Legacy-"]
}
```

### `POST /api/admin/identity-group-sync/dry-run`

Runs a preview without mutating MongoDB, Keycloak, or OpenFGA.

**Request**

```json
{
  "provider_id": "okta-primary",
  "rule_ids": ["rule-platform-teams"],
  "sample_limit": 500,
  "include_members": true
}
```

**Response**

```json
{
  "run_id": "sync-run-preview-001",
  "mode": "dry_run",
  "status": "completed",
  "summary": {
    "matched_groups": 28,
    "ignored_groups": 141,
    "teams_to_create": 4,
    "memberships_to_add": 213,
    "memberships_to_remove": 12,
    "skipped_users": 6,
    "conflicts": 1,
    "relationship_grants": 426,
    "relationship_revocations": 24
  },
  "conflicts": [
    {
      "type": "team_slug_collision",
      "team_slug": "platform",
      "external_group_id": "00g123",
      "message": "Generated team slug already exists with a different external group link"
    }
  ]
}
```

### `POST /api/admin/identity-group-sync/apply`

Applies a reviewed dry-run or starts an applied reconciliation.

**Request**

```json
{
  "provider_id": "okta-primary",
  "rule_ids": ["rule-platform-teams"],
  "based_on_run_id": "sync-run-preview-001",
  "apply_membership_removals": true,
  "apply_team_creates": true
}
```

**Response**

```json
{
  "run_id": "sync-run-apply-001",
  "mode": "manual_apply",
  "status": "running"
}
```

### `GET /api/admin/identity-group-sync/runs/{run_id}`

Returns run status, summary, warnings, errors, generated team links, membership diffs, and generated ReBAC tuple diffs.

### `GET /api/admin/identity-group-sync/teams/{team_id}/membership-sources`

Returns all source records explaining team membership.

**Response**

```json
{
  "team": {
    "id": "team-platform",
    "slug": "platform"
  },
  "memberships": [
    {
      "user_subject": "user-123",
      "user_email": "user@example.com",
      "relationship": "member",
      "sources": [
        {
          "source_type": "manual",
          "status": "active",
          "managed": false
        },
        {
          "source_type": "okta",
          "provider_id": "okta-primary",
          "external_group_id": "00g123",
          "status": "active",
          "managed": true
        }
      ]
    }
  ]
}
```

### `POST /api/admin/identity-group-sync/skipped-users/{source_id}/resolve`

Links a skipped upstream member to a Keycloak subject or marks the record intentionally ignored.

**Request**

```json
{
  "resolution": "link_user",
  "user_subject": "user-123"
}
```

## Errors

- `400`: invalid regex, unsupported role map, invalid provider capability, or malformed request.
- `403`: missing ReBAC permission for provider, team, or admin surface.
- `409`: stale dry-run, team slug collision, conflicting rule priority, or unsafe removal blocked.
- `422`: valid request shape but unresolved identity links or conflicts prevent apply.
- `500`: unexpected provider, database, Keycloak, or OpenFGA failure.
