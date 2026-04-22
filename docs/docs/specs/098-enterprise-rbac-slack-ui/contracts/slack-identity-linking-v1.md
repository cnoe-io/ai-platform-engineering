# Contract: Slack Identity Linking v1

API contract for the Slack identity linking flow (FR-025).

## Contract overview

| Property | Value |
|----------|-------|
| **Version** | 1 |
| **Status** | Draft |
| **FR coverage** | FR-025, FR-032 |
| **Services** | UI BFF (Next.js), Slack bot (Python) |

## Endpoints

### POST `/api/auth/slack-link` (BFF Callback)

Handles the OIDC authorization code exchange after the user clicks the linking URL.

**Query parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `nonce` | string | Yes | Single-use linking nonce (10min TTL) |
| `slack_user_id` | string | Yes | Slack user ID to link |
| `code` | string | Yes | OIDC authorization code from Keycloak |
| `state` | string | Yes | OIDC state parameter |

**Success response** (302 redirect to success page):
- Stores `slack_user_id` as Keycloak user attribute via Admin API
- Posts confirmation DM to user via Slack Web API
- Renders HTML success page

**Error responses**:

| Status | Condition |
|--------|-----------|
| 400 | Nonce expired (>10min) or already consumed |
| 400 | Missing required parameters |
| 401 | OIDC code exchange failed |
| 500 | Keycloak Admin API or Slack API error |

### GET `/api/auth/my-roles` (User Self-Service)

Returns the authenticated user's full RBAC posture (FR-036).

**Authentication**: Required (NextAuth session)

**Response** (200):

```json
{
  "email": "user@example.com",
  "realm_roles": ["chat_user", "team_member", "kb_reader:kb-team-a"],
  "teams": [
    { "id": "team-a-id", "name": "Team Alpha" }
  ],
  "per_kb_roles": [
    { "kb_id": "kb-team-a", "kb_name": "Team A Docs", "scope": "reader" }
  ],
  "per_agent_roles": [
    { "agent_id": "agent-123", "agent_name": "My Agent", "scope": "user" }
  ],
  "idp_source": "duo-sso",
  "slack_linked": true,
  "slack_user_id": "U1234567"
}
```

### Admin Slack Endpoints

#### GET `/api/admin/slack/users` (FR-032a)

Returns Slack user bootstrapping data for the admin dashboard.

**Authentication**: Required (admin role)
**Pagination**: `?page=1&limit=20`

**Response** (200):

```json
{
  "users": [
    {
      "slack_user_id": "U1234567",
      "slack_display_name": "John Doe",
      "link_status": "linked",
      "keycloak_username": "jdoe",
      "keycloak_sub": "user-uuid",
      "roles": ["chat_user", "team_member"],
      "teams": ["Team Alpha"],
      "link_timestamp": "2026-03-25T10:00:00Z",
      "last_bot_interaction": "2026-03-25T14:30:00Z",
      "obo_success_count": 42,
      "obo_fail_count": 1,
      "active_channels": ["C1234", "C5678"]
    }
  ],
  "total": 25,
  "page": 1,
  "limit": 20
}
```

#### GET `/api/admin/slack/channel-mappings` (FR-032b)

Returns channel-to-team mappings.

**Authentication**: Required (admin role)

**Response** (200):

```json
{
  "mappings": [
    {
      "_id": "mapping-id",
      "slack_channel_id": "C1234567",
      "channel_name": "#team-a-general",
      "team_id": "team-a-id",
      "team_name": "Team Alpha",
      "created_by": "admin@example.com",
      "created_at": "2026-03-25T10:00:00Z",
      "active": true
    }
  ]
}
```

#### POST `/api/admin/slack/channel-mappings`

Creates a new channel-to-team mapping.

**Request body**:

```json
{
  "slack_channel_id": "C1234567",
  "team_id": "team-a-id"
}
```

#### DELETE `/api/admin/slack/channel-mappings/[id]`

Removes a channel-to-team mapping.
