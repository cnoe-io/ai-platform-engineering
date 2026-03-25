---
sidebar_position: 2
---

# Admin & User Management API

Next.js App Router UI Backend API routes under `/api/admin/*`, `/api/users/*`, and `/api/user/*`. Most handlers use `withAuth` (NextAuth session); admin capabilities split into **full admin** (`requireAdmin`: OIDC admin group or MongoDB `metadata.role === 'admin'`) and **admin view** (`requireAdminView`: admin **or** `session.canViewAdmin` from the admin-view OIDC group).

**Response shapes**

- **Wrapped success** (`successResponse`): `{ "success": true, "data": <payload> }`
- **Paginated** (`paginatedResponse`): `{ "success": true, "data": { "items", "total", "page", "page_size", "has_more" } }`
- **Direct JSON** (some routes): payload at top level (e.g. `GET /api/admin/users`, Prometheus proxy)
- **Errors** (`ApiError` / `withErrorHandler`): `{ "success": false, "error": "<message>", "code"?: "<optional>" }`

**Base path:** prepend your CAIPE UI origin (e.g. `https://app.example.com`).

---

## User Management (CRUD, search, filters)

### GET `/api/admin/users`

**Auth:** Session (admin view) | **Since:** v1.0

Lists Keycloak realm users with optional filters and pagination. Enriched with realm role names. Does **not** use the `{ success, data }` wrapper.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | No | Keycloak user search string |
| `role` | string | No | Filter to users assigned this **realm role name** |
| `team` | string | No | Filter to members of team (`team_id` in `team_kb_ownership`); requires MongoDB |
| `idp` | string | No | Filter to users with a federated identity from this IdP alias |
| `slackStatus` | string | No | `linked` or `unlinked` (Slack via `slack_user_id` attribute) |
| `enabled` | boolean | No | `true` / `false` / `1` / `0` |
| `page` | integer | No | Default `1`, must be ≥ 1 |
| `pageSize` | integer | No | Default `20`, between 1 and 100 |

**Request Body:**

_(none)_

**Response `200`:**

```json
{
  "users": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "username": "jdoe",
      "email": "jdoe@example.com",
      "firstName": "Jane",
      "lastName": "Doe",
      "enabled": true,
      "attributes": {
        "slack_user_id": ["U01234567"]
      },
      "roles": ["chat_user", "team_member(team-a)"]
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | — | No session |
| 403 | — | Missing admin view permission |
| 400 | — | Invalid `enabled`, `slackStatus`, `page`, or `pageSize` |
| 503 | `MONGODB_NOT_CONFIGURED` | Team filter requested but MongoDB unavailable; body is `{ "error", "code" }` (no `success` field) |

---

### GET `/api/admin/users/[id]`

**Auth:** Session (admin view) | **Since:** v1.0

Returns a single user from Keycloak plus sessions, federated identities, realm roles, Slack link status, and team rows from `team_kb_ownership` (if MongoDB configured).

**Query Parameters:**

_(none)_

**Request Body:**

_(none)_

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "username": "jdoe",
      "email": "jdoe@example.com",
      "firstName": "Jane",
      "lastName": "Doe",
      "enabled": true,
      "createdAt": 1700000000000,
      "attributes": {
        "slack_user_id": ["U01234567"]
      },
      "slackLinkStatus": "linked",
      "realmRoles": [
        {
          "id": "role-uuid",
          "name": "chat_user",
          "description": "Chat access"
        }
      ],
      "sessions": [
        {
          "id": "session-id",
          "username": "jdoe",
          "ipAddress": "203.0.113.1",
          "start": 1700000000000,
          "lastAccess": 1700003600000,
          "rememberMe": false
        }
      ],
      "federatedIdentities": [
        {
          "identityProvider": "oidc",
          "userId": "sub-123",
          "userName": "jdoe@example.com"
        }
      ],
      "teams": [
        {
          "team_id": "team-a",
          "tenant_id": "default"
        }
      ],
      "lastAccess": 1700003600000
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | — | Unauthorized |
| 403 | — | Admin view required |
| 404 | — | Keycloak user not found (from admin client) |
| 500 | — | Upstream Keycloak errors |

---

### PUT `/api/admin/users/[id]`

**Auth:** Session (admin view) | **Since:** v1.0

Merges JSON body with the existing Keycloak user representation and calls Keycloak Admin API `updateUser`. Use Keycloak user fields (e.g. `firstName`, `lastName`, `email`, `enabled`, `attributes`).

**Query Parameters:**

_(none)_

**Request Body:**

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "enabled": true,
  "attributes": {
    "slack_user_id": ["U01234567"]
  }
}
```

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
| 400 | — | Invalid JSON body |
| 401 | — | Unauthorized |
| 403 | — | Admin view required |

---

### POST `/api/admin/users/[id]/roles`

**Auth:** Session (admin) | **Since:** v1.0

Assigns realm roles by name to the user.

**Query Parameters:**

_(none)_

**Request Body:**

```json
{
  "roles": [
    { "name": "chat_user" },
    { "name": "kb_admin" }
  ]
}
```

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
| 400 | — | Invalid body: missing `roles`, empty array, or invalid entries |
| 401 | — | Unauthorized |
| 403 | — | Full admin required |
| 404 | — | Unknown role name (Keycloak) |

---

### DELETE `/api/admin/users/[id]/roles`

**Auth:** Session (admin) | **Since:** v1.0

Removes realm roles by name from the user. Same body shape as POST.

**Request Body:**

```json
{
  "roles": [{ "name": "kb_admin" }]
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "ok": true
  }
}
```

**Errors:** Same as POST for roles.

---

### POST `/api/admin/users/[id]/teams`

**Auth:** Session (admin) | **Since:** v1.0

Adds the user’s **email** (lowercased) to `members` on the `team_kb_ownership` document for `teamId`.

**Request Body:**

```json
{
  "teamId": "team-a"
}
```

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
| 400 | — | Missing `teamId`, user has no email |
| 401 | — | Unauthorized |
| 403 | — | Admin required |
| 404 | — | No `team_kb_ownership` row for `teamId` |
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB not configured |

---

### DELETE `/api/admin/users/[id]/teams`

**Auth:** Session (admin) | **Since:** v1.0

Removes the user’s email from `team_kb_ownership.members` for `teamId`.

**Request Body:**

```json
{
  "teamId": "team-a"
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "ok": true
  }
}
```

**Errors:** Same family as POST teams.

---

### PATCH `/api/admin/users/{id}/role`

**Auth:** Session (admin) | **Since:** v1.0

Updates MongoDB `users.metadata.role` for the target user. The `{id}` parameter accepts either a Keycloak user ID or an email address (URL-encoded, e.g. `user%40example.com`).

**Request Body:**

```json
{
  "role": "admin"
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "message": "User role updated to admin",
    "email": "user@example.com",
    "role": "admin"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | `role` not `admin` or `user` |
| 401 | — | Unauthorized |
| 403 | — | Admin required |
| 404 | — | User document not found in MongoDB |
| 503 | — | MongoDB not configured |

---

### POST `/api/admin/migrate-conversations`

**Auth:** Session (admin) | **Since:** v1.0

Imports conversations (and messages) from client-local payloads into MongoDB, owned by the **calling** admin user. Skips IDs that already exist.

**Request Body:**

```json
{
  "conversations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Imported chat",
      "createdAt": "2025-01-15T12:00:00.000Z",
      "messages": [
        {
          "role": "user",
          "content": "Hello",
          "created_at": "2025-01-15T12:00:01.000Z",
          "turn_id": "turn-0"
        }
      ]
    }
  ]
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "message": "Successfully migrated 1 conversations",
    "migrated": 1,
    "skipped": 0,
    "errors": ["Optional: per-conversation error strings when partial failure"]
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | — | Unauthorized |
| 403 | — | Admin required |
| 503 | — | MongoDB not configured |

---

## Team Management (CRUD, members, roles)

### GET `/api/admin/teams`

**Auth:** Session (admin view) | **Since:** v1.0

Lists all MongoDB `teams` documents, newest first.

**Query Parameters:**

_(none)_

**Request Body:**

_(none)_

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "teams": [
      {
        "_id": "65a1b2c3d4e5f6789012345",
        "name": "Platform",
        "description": "Core platform team",
        "owner_id": "lead@example.com",
        "created_at": "2025-01-01T00:00:00.000Z",
        "updated_at": "2025-01-02T00:00:00.000Z",
        "members": [
          {
            "user_id": "lead@example.com",
            "role": "owner",
            "added_at": "2025-01-01T00:00:00.000Z",
            "added_by": "lead@example.com"
          }
        ],
        "keycloak_roles": ["team_member(platform)"]
      }
    ],
    "total": 1
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | — | Unauthorized |
| 403 | — | Admin view required |
| 503 | — | MongoDB not configured |

---

### POST `/api/admin/teams`

**Auth:** Session (admin) | **Since:** v1.0

Creates a team. Creator is always added as `owner`. Optional `members` become `member` role entries.

**Request Body:**

```json
{
  "name": "New Team",
  "description": "Optional description",
  "members": ["member1@example.com", "member2@example.com"]
}
```

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "message": "Team created successfully",
    "team_id": "65a1b2c3d4e5f6789012345",
    "team": {
      "name": "New Team",
      "description": "",
      "owner_id": "admin@example.com",
      "created_at": "2025-03-25T12:00:00.000Z",
      "updated_at": "2025-03-25T12:00:00.000Z",
      "members": []
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Empty name or duplicate team name |
| 401 | — | Unauthorized |
| 403 | — | Admin required |
| 503 | — | MongoDB not configured |

---

### GET `/api/admin/teams/[id]`

**Auth:** Session (admin view) | **Since:** v1.0

`[id]` is a MongoDB ObjectId string.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "team": {
      "_id": "65a1b2c3d4e5f6789012345",
      "name": "Platform",
      "description": "",
      "owner_id": "lead@example.com",
      "members": [],
      "created_at": "2025-01-01T00:00:00.000Z",
      "updated_at": "2025-01-02T00:00:00.000Z"
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Invalid ObjectId |
| 404 | — | Team not found |
| 503 | — | MongoDB not configured |

---

### PATCH `/api/admin/teams/[id]`

**Auth:** Session (admin) | **Since:** v1.0

Updates `name` and/or `description`.

**Request Body:**

```json
{
  "name": "Renamed Team",
  "description": "Updated"
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "team": {
      "_id": "65a1b2c3d4e5f6789012345",
      "name": "Renamed Team",
      "description": "Updated",
      "owner_id": "lead@example.com",
      "members": [],
      "created_at": "2025-01-01T00:00:00.000Z",
      "updated_at": "2025-03-25T12:00:00.000Z"
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Empty name or duplicate name |
| 404 | — | Team not found |

---

### DELETE `/api/admin/teams/[id]`

**Auth:** Session (admin) | **Since:** v1.0

Deletes the team and best-effort removes its id from conversations’ `sharing.shared_with_teams`.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "message": "Team deleted successfully",
    "deleted": true
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | — | Team not found |

---

### POST `/api/admin/teams/[id]/members`

**Auth:** Session (admin) | **Since:** v1.0

**Request Body:**

```json
{
  "user_id": "newmember@example.com",
  "role": "member"
}
```

`role` defaults to `member`; allowed: `admin`, `member`.

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "team": {
      "_id": "65a1b2c3d4e5f6789012345",
      "name": "Platform",
      "members": [
        {
          "user_id": "newmember@example.com",
          "role": "member",
          "added_at": "2025-03-25T12:00:00.000Z",
          "added_by": "admin@example.com"
        }
      ]
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Missing/invalid email, invalid role, duplicate member |
| 404 | — | Team not found |

---

### DELETE `/api/admin/teams/[id]/members`

**Auth:** Session (admin) | **Since:** v1.0

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | Member email to remove |

**Request Body:**

_(none)_

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "team": {
      "_id": "65a1b2c3d4e5f6789012345",
      "name": "Platform",
      "members": []
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Missing `user_id`, or cannot remove owner |
| 404 | — | Team not found or user not a member |

---

### GET `/api/admin/teams/[id]/roles`

**Auth:** Session (admin) | **Since:** v1.0

Returns `keycloak_roles` from the team document.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "roles": ["team_member(platform)"]
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | — | Team not found |

---

### PUT `/api/admin/teams/[id]/roles`

**Auth:** Session (admin) | **Since:** v1.0

Replaces `keycloak_roles` on the team.

**Request Body:**

```json
{
  "roles": ["team_member(platform)", "kb_reader:kb-1"]
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "team": {
      "_id": "65a1b2c3d4e5f6789012345",
      "name": "Platform",
      "keycloak_roles": ["team_member(platform)", "kb_reader:kb-1"],
      "updated_at": "2025-03-25T12:00:00.000Z"
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | `roles` not an array of strings |
| 404 | — | Team not found |

---

## Platform Statistics

### GET `/api/admin/stats`

**Auth:** Session (admin view) | **Since:** v1.0

Aggregated platform analytics from MongoDB (`users`, `conversations`, `messages`).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `range` | string | No | `1d`, `7d`, `30d` (default), `90d` — length of `daily_activity` and related windows |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "range": "30d",
    "days": 30,
    "overview": {
      "total_users": 120,
      "total_conversations": 5000,
      "total_messages": 45000,
      "shared_conversations": 200,
      "dau": 45,
      "mau": 110,
      "conversations_today": 30,
      "messages_today": 220,
      "avg_messages_per_conversation": 9
    },
    "daily_activity": [
      {
        "date": "2025-03-24",
        "active_users": 40,
        "conversations": 28,
        "messages": 210
      }
    ],
    "top_users": {
      "by_conversations": [{ "_id": "user@example.com", "count": 120 }],
      "by_messages": [{ "_id": "user@example.com", "count": 900 }]
    },
    "top_agents": [{ "_id": "platform_engineer", "count": 3000 }],
    "feedback_summary": {
      "positive": 800,
      "negative": 40,
      "total": 840
    },
    "response_time": {
      "avg_ms": 2100,
      "min_ms": 400,
      "max_ms": 12000,
      "sample_count": 500
    },
    "hourly_heatmap": [{ "hour": 0, "count": 12 }],
    "completed_workflows": {
      "total": 800,
      "today": 15,
      "interrupted": 120,
      "completion_rate": 87.5,
      "avg_messages_per_workflow": 8.2
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB unavailable |

---

### GET `/api/admin/stats/checkpoints`

**Auth:** Session (admin view) | **Since:** v1.0

LangGraph checkpoint collections (`checkpoints_*`, `checkpoint_writes_*`) stats.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `range` | string | No | Affects default window label (`1d`/`7d`/`30d`/`90d`, default `7d` for internal day map) |
| `peek` | string | No | If `false`, omit `peek_data`; default includes peek |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "name": "my_agent",
        "checkpoints": 1000,
        "writes": 5000,
        "latest_checkpoint": "2025-03-25T10:00:00.000Z",
        "threads": 42
      }
    ],
    "totals": {
      "total_checkpoints": 1000,
      "total_writes": 5000,
      "total_threads": 40,
      "active_agents": 3,
      "total_agents": 5
    },
    "daily_activity": [{ "date": "2025-03-25", "writes": 5000 }],
    "cross_contamination": {
      "shared_threads": 0,
      "details": []
    },
    "peek_data": [
      {
        "agent": "my_agent",
        "collection": "checkpoints_my_agent",
        "documents": [{ "_id": "...", "thread_id": "thread-1" }]
      }
    ],
    "range": "7d"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB unavailable |

---

### GET `/api/admin/stats/skills`

**Auth:** Session (admin view) | **Since:** v1.0

Skill (`agent_configs`) and workflow run aggregates.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "total_skills": 50,
    "system_skills": 10,
    "user_skills": 40,
    "by_visibility": { "private": 30, "team": 8, "global": 2 },
    "by_category": [{ "category": "DevOps", "count": 12 }],
    "top_creators": [{ "email": "builder@example.com", "count": 5 }],
    "daily_created": [{ "date": "2025-03-20", "count": 2 }],
    "top_skills_by_runs": [
      {
        "skill_id": "skill-uuid",
        "skill_name": "Deploy helper",
        "total_runs": 100,
        "completed": 95,
        "failed": 5,
        "success_rate": 95,
        "last_run": "2025-03-25T09:00:00.000Z",
        "avg_duration_ms": 1200
      }
    ],
    "overall_run_stats": {
      "total_runs": 500,
      "completed": 480,
      "failed": 20,
      "success_rate": 96,
      "avg_duration_ms": 1100
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB unavailable |

---

### GET `/api/admin/metrics`

**Auth:** Session (admin view) | **Since:** v1.0

Proxies to Prometheus HTTP API (`PROMETHEUS_URL`).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | PromQL expression |
| `type` | string | No | `instant` (default) or `range` |
| `start` | string | For range | Start (RFC3339 or unix) |
| `end` | string | For range | End |
| `step` | string | No | e.g. `60s` (range) |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "status": "success",
    "data": {
      "resultType": "vector",
      "result": []
    }
  }
}
```

(Prometheus native JSON; shape matches `/api/v1/query` or `/api/v1/query_range`.)

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Missing `query` or range params |
| 502 | — | Prometheus HTTP error |
| 503 | `PROMETHEUS_NOT_CONFIGURED` | Env not set |
| 504 | — | Query timeout |

---

### POST `/api/admin/metrics`

**Auth:** Session (authenticated) | **Since:** v1.0

Batch PromQL: up to 20 queries. **Note:** Handler uses `withAuth` only (no `requireAdminView` in code).

**Request Body:**

```json
{
  "queries": [
    {
      "id": "q1",
      "query": "up",
      "type": "instant"
    },
    {
      "id": "q2",
      "query": "rate(http_requests_total[5m])",
      "type": "range",
      "start": "1710000000",
      "end": "1710003600",
      "step": "60s"
    }
  ]
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "q1": { "status": "success", "data": { "resultType": "vector", "result": [] } },
    "q2": { "status": "error", "error": "HTTP 500" }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Invalid `queries` array |
| 503 | `PROMETHEUS_NOT_CONFIGURED` | Env not set |

---

## Feedback & NPS

### GET `/api/admin/feedback`

**Auth:** Session (admin view) | **Since:** v1.0

Lists messages that have `feedback.rating`, with conversation titles.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `rating` | string | No | `positive` or `negative` filter |
| `page` | integer | No | Default `1` |
| `limit` | integer | No | Default `50`, max `100` |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "message_id": "msg-uuid",
        "conversation_id": "conv-uuid",
        "conversation_title": "My chat",
        "content_snippet": "Assistant reply preview...",
        "role": "assistant",
        "rating": "positive",
        "reason": "Helpful answer",
        "submitted_by": "user@example.com",
        "submitted_at": "2025-03-25T12:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 120,
      "total_pages": 3
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `FEEDBACK_DISABLED` | Feature flag off |
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB unavailable |

---

### GET `/api/admin/nps`

**Auth:** Session (admin view) | **Since:** v1.0

NPS analytics when `npsEnabled` is true.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `campaign_id` | string | No | Filter responses to one campaign |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "nps_score": 35,
    "total_responses": 100,
    "breakdown": {
      "promoters": 50,
      "passives": 30,
      "detractors": 20,
      "promoter_pct": 50,
      "passive_pct": 30,
      "detractor_pct": 20
    },
    "trend": [
      {
        "date": "2025-03-25",
        "avg_score": 8.2,
        "count": 5,
        "nps": 40
      }
    ],
    "recent_responses": [
      {
        "user_email": "user@example.com",
        "score": 9,
        "comment": "Great product",
        "created_at": "2025-03-25T12:00:00.000Z"
      }
    ],
    "campaigns": [
      {
        "_id": "65a1b2c3d4e5f6789012345",
        "name": "Q1 Survey",
        "starts_at": "2025-01-01T00:00:00.000Z",
        "ends_at": "2025-03-31T23:59:59.000Z",
        "created_by": "admin@example.com",
        "created_at": "2025-01-01T00:00:00.000Z",
        "response_count": 100,
        "status": "active"
      }
    ]
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `NPS_DISABLED` | Feature off |
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB unavailable |

---

### GET `/api/admin/nps/campaigns`

**Auth:** Session (admin view) | **Since:** v1.0

Lists campaigns with `response_count` and `status` (`active` | `ended` | `scheduled`).

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "campaigns": [
      {
        "_id": "65a1b2c3d4e5f6789012345",
        "name": "Q1 Survey",
        "starts_at": "2025-01-01T00:00:00.000Z",
        "ends_at": "2025-03-31T23:59:59.000Z",
        "created_by": "admin@example.com",
        "created_at": "2025-01-01T00:00:00.000Z",
        "response_count": 10,
        "status": "active"
      }
    ]
  }
}
```

**Errors:** Same as NPS GET for disabled / MongoDB.

---

### POST `/api/admin/nps/campaigns`

**Auth:** Session (admin) | **Since:** v1.0

Creates a campaign; rejects overlapping date ranges.

**Request Body:**

```json
{
  "name": "April pulse",
  "starts_at": "2025-04-01T00:00:00.000Z",
  "ends_at": "2025-04-30T23:59:59.000Z"
}
```

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "name": "April pulse",
    "starts_at": "2025-04-01T00:00:00.000Z",
    "ends_at": "2025-04-30T23:59:59.000Z",
    "created_by": "admin@example.com",
    "created_at": "2025-03-25T12:00:00.000Z",
    "_id": "65a1b2c3d4e5f6789012345"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Invalid dates or `ends_at` ≤ `starts_at` |
| 409 | — | Overlapping campaign |

---

### PATCH `/api/admin/nps/campaigns`

**Auth:** Session (admin) | **Since:** v1.0

Ends a campaign early (`ends_at` set to now, `stopped_by`, `stopped_at`).

**Request Body:**

```json
{
  "campaign_id": "65a1b2c3d4e5f6789012345"
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "stopped": true,
    "ended_at": "2025-03-25T12:00:00.000Z"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Invalid `campaign_id` or campaign already ended |
| 404 | — | Campaign not found |

---

## Audit Logs

Requires `auditLogsEnabled` and MongoDB.

### GET `/api/admin/audit-logs`

**Auth:** Session (admin) | **Since:** v1.0

Paginated conversation list for auditing. Pagination uses `page` and `page_size` (see `getPaginationParams`).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | integer | No | Default `1` |
| `page_size` | integer | No | Default `20`, max `100` |
| `owner_email` | string | No | Case-insensitive regex on `owner_id` |
| `search` | string | No | Case-insensitive regex on `title` |
| `date_from` | ISO date | No | `created_at` lower bound |
| `date_to` | ISO date | No | `created_at` upper bound |
| `include_deleted` | boolean | No | `true` to include soft-deleted |
| `status` | string | No | `active`, `archived`, or `deleted` |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "_id": "conv-uuid",
        "title": "Audit target",
        "owner_id": "user@example.com",
        "created_at": "2025-01-01T00:00:00.000Z",
        "updated_at": "2025-01-02T00:00:00.000Z",
        "metadata": { "total_messages": 12, "agent_version": "1", "model_used": "gpt-4o" },
        "sharing": {
          "is_public": false,
          "shared_with": [],
          "shared_with_teams": [],
          "share_link_enabled": false
        },
        "tags": [],
        "is_archived": false,
        "is_pinned": false,
        "message_count": 12,
        "last_message_at": "2025-01-02T00:00:00.000Z",
        "status": "active"
      }
    ],
    "total": 1,
    "page": 1,
    "page_size": 20,
    "has_more": false
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 403 | `FEATURE_DISABLED` | Audit logs disabled |
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB unavailable |

---

### GET `/api/admin/audit-logs/owners`

**Auth:** Session (admin) | **Since:** v1.0

Distinct conversation owners (for filters), optionally filtered.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | No | Case-insensitive regex on `owner_id` |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "owners": ["alice@example.com", "bob@example.com"]
  }
}
```

**Errors:** Same as audit list for feature / MongoDB.

---

### GET `/api/admin/audit-logs/export`

**Auth:** Session (admin) | **Since:** v1.0

CSV download (max 10 000 rows). Same filter query params as `GET /api/admin/audit-logs` (`owner_email`, `search`, `date_from`, `date_to`, `include_deleted`, `status`).

**Response `200`:** `Content-Type: text/csv` with `Content-Disposition: attachment; filename="audit-logs-<timestamp>.csv"`. Body is CSV text, not JSON.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 403 | `FEATURE_DISABLED` | Audit logs disabled |
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB unavailable |

---

### GET `/api/admin/audit-logs/[id]/messages`

**Auth:** Session (admin) | **Since:** v1.0

Conversation metadata plus paginated messages. `[id]` is conversation UUID.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | integer | No | Default `1` |
| `page_size` | integer | No | Default `20`, max `100` |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "conversation": {
      "_id": "conv-uuid",
      "title": "Title",
      "owner_id": "user@example.com",
      "created_at": "2025-01-01T00:00:00.000Z",
      "updated_at": "2025-01-02T00:00:00.000Z",
      "tags": [],
      "sharing": {
        "is_public": false,
        "shared_with": [],
        "shared_with_teams": [],
        "share_link_enabled": false
      },
      "is_archived": false,
      "deleted_at": null
    },
    "messages": {
      "items": [
        {
          "_id": "656565656565656565656565",
          "conversation_id": "conv-uuid",
          "role": "user",
          "content": "Hello",
          "created_at": "2025-01-01T00:00:00.000Z",
          "metadata": { "turn_id": "turn-1" }
        }
      ],
      "total": 1,
      "page": 1,
      "page_size": 20,
      "has_more": false
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Missing conversation id |
| 404 | `NOT_FOUND` | Conversation missing |
| 403 | `FEATURE_DISABLED` | Audit logs disabled |

---

## Current User (self-service)

### GET `/api/users/me`

**Auth:** Session (authenticated) | **Since:** v1.0

Loads or creates the MongoDB `users` document and refreshes `last_login`.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "_id": "656565656565656565656565",
    "email": "user@example.com",
    "name": "User Name",
    "created_at": "2025-01-01T00:00:00.000Z",
    "updated_at": "2025-01-02T00:00:00.000Z",
    "last_login": "2025-03-25T12:00:00.000Z",
    "metadata": {
      "sso_provider": "duo",
      "sso_id": "user@example.com",
      "role": "user"
    }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | — | No session |

---

### PUT `/api/users/me`

**Auth:** Session (authenticated) | **Since:** v1.0

**Request Body:**

```json
{
  "name": "New Display Name",
  "avatar_url": "https://cdn.example.com/avatar.png"
}
```

**Response `200`:** Same shape as GET — full updated user document in `data`.

---

### GET `/api/users/me/stats`

**Auth:** Session (authenticated) | **Since:** v1.0

Usage stats for conversations owned by the current user.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "total_conversations": 10,
    "total_messages": 200,
    "total_tokens_used": 50000,
    "conversations_this_week": 2,
    "messages_this_week": 15,
    "favorite_agents": [{ "name": "platform_engineer", "count": 80 }]
  }
}
```

---

### GET `/api/users/me/insights`

**Auth:** Session (authenticated) | **Since:** v1.0

Rich personal analytics (30-day usage, skills via `workflow_runs`, prompts, agents, feedback).

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "overview": {
      "total_conversations": 10,
      "total_messages": 200,
      "total_tokens_used": 50000,
      "conversations_this_week": 2,
      "messages_this_week": 15,
      "avg_messages_per_conversation": 20
    },
    "skill_usage": [
      {
        "category": "Custom",
        "total_runs": 5,
        "completed": 4,
        "failed": 1,
        "last_run": "2025-03-20T10:00:00.000Z"
      }
    ],
    "recent_prompts": [
      {
        "content": "How do I deploy?",
        "content_length": 18,
        "conversation_id": "conv-uuid",
        "conversation_title": "Deploy help",
        "timestamp": "2025-03-25T12:00:00.000Z"
      }
    ],
    "daily_usage": [{ "date": "2025-03-25", "prompts": 3, "responses": 3 }],
    "prompt_patterns": {
      "avg_length": 120,
      "max_length": 2000,
      "total_prompts": 50,
      "peak_hour": 14,
      "peak_hour_label": "14:00 UTC",
      "peak_day": "Tuesday"
    },
    "favorite_agents": [{ "name": "platform_engineer", "count": 40 }],
    "feedback_given": { "positive": 5, "negative": 0, "total": 5 }
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB unavailable |

---

### GET `/api/users/me/insights/skills`

**Auth:** Session (authenticated) | **Since:** v1.0

Personal skill configs and run statistics.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "total_skills": 3,
    "by_visibility": { "private": 2, "team": 1, "global": 0 },
    "by_category": [{ "category": "DevOps", "count": 2 }],
    "recent_skills": [
      {
        "id": "skill-id",
        "name": "My skill",
        "visibility": "private",
        "category": "DevOps",
        "created_at": "2025-03-01T00:00:00.000Z"
      }
    ],
    "run_stats": [
      {
        "skill_id": "skill-id",
        "skill_name": "My skill",
        "total_runs": 10,
        "completed": 9,
        "failed": 1,
        "success_rate": 90,
        "last_run": "2025-03-25T10:00:00.000Z",
        "avg_duration_ms": 800
      }
    ],
    "daily_created": [{ "date": "2025-03-10", "count": 1 }]
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 503 | `MONGODB_NOT_CONFIGURED` | MongoDB unavailable |

---

### GET `/api/users/me/favorites`

**Auth:** Session (authenticated) | **Since:** v1.0

Returns favorite agent config IDs from MongoDB.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "favorites": ["skill-id-1", "skill-id-2"]
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 503 | — | MongoDB not configured (`ApiError`) |

---

### PUT `/api/users/me/favorites`

**Auth:** Session (authenticated) | **Since:** v1.0

**Request Body:**

```json
{
  "favorites": ["skill-id-1", "skill-id-2"]
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "favorites": ["skill-id-1", "skill-id-2"],
    "message": "Favorites updated successfully"
  }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | `favorites` not an array of strings |

---

### GET `/api/users/search`

**Auth:** Session (authenticated) | **Since:** v1.0

Search MongoDB users by email or name (for sharing, etc.).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Min length 2 |

**Response `200`:**

```json
{
  "success": true,
  "data": [
    {
      "email": "colleague@example.com",
      "name": "Colleague",
      "avatar_url": "https://cdn.example.com/a.png"
    }
  ]
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | — | Query too short |

---

### GET `/api/user/info`

**Auth:** None required by the route; RAG decides | **Since:** v1.0

Server-side proxy to RAG server `GET /v1/user/info`. When NextAuth has `session.accessToken`, the handler adds `Authorization: Bearer <accessToken>`; otherwise RAG may treat the caller as anonymous or use trusted-network rules. HTTP status and JSON body are passed through from RAG.

**Example `200` (typical RAG shape):**

```json
{
  "email": "user@example.com",
  "role": "readonly",
  "is_authenticated": true,
  "groups": [],
  "permissions": ["read"],
  "in_trusted_network": false
}
```

**Errors:**

| Status | Description |
|--------|-------------|
| 502 | UI could not reach RAG server |

---

### GET `/api/users/debug`

**Auth:** Session (authenticated) | **Since:** v1.0

Returns a truncated list of all MongoDB users (intended for development/debugging).

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "total_users": 2,
    "users": [
      {
        "email": "a@example.com",
        "name": "A",
        "created_at": "2025-01-01T00:00:00.000Z",
        "last_login": "2025-03-25T12:00:00.000Z"
      }
    ]
  }
}
```

---

## Related

- Shared UI Backend API helpers: `ui/src/lib/api-middleware.ts` (`withAuth`, `requireAdmin`, `requireAdminView`, `successResponse`, `paginatedResponse`, `ApiError`).
- Keycloak admin calls: `ui/src/lib/rbac/keycloak-admin.ts`.
