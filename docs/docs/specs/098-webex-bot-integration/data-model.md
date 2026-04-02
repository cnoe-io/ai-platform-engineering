# Data Model: Webex Bot Integration

**Feature**: `098-webex-bot-integration` | **Date**: 2026-03-18

## Entities

### WebexSession

Maps a Webex conversation thread to an A2A context for multi-turn conversations.

| Field | Type | Description |
|-------|------|-------------|
| `thread_key` | string | Primary key. Format: `{roomId}` for 1:1 spaces, `{roomId}:{parentMessageId}` for threaded group conversations |
| `context_id` | string (UUID) | A2A context ID returned by the supervisor on first interaction |
| `trace_id` | string | Langfuse trace ID for observability |
| `created_at` | datetime | When the session was first created |
| `updated_at` | datetime | Last activity timestamp |

Storage: MongoDB collection `webex_sessions` (via Webex bot's own `SessionStore` — copied from Slack bot) or in-memory dictionary.

### WebexDeviceInfo

WDM device registration data for WebSocket connection.

| Field | Type | Description |
|-------|------|-------------|
| `deviceName` | string | Fixed: `"caipe-webex-client"` |
| `deviceType` | string | Fixed: `"DESKTOP"` |
| `localizedModel` | string | Fixed: `"python"` |
| `model` | string | Fixed: `"python"` |
| `name` | string | Unique device name with random suffix (e.g., `"caipe-webex-client-A3B5C"`) |
| `systemName` | string | Fixed: `"caipe-webex-bot"` |
| `systemVersion` | string | Application version |
| `webSocketUrl` | string | Returned by WDM after registration; used for WebSocket connection |
| `url` | string | Device URL for management |

Storage: In-memory only. Re-registered on restart.

### WebexConfig

Bot configuration loaded from environment variables.

| Field | Type | Source Env Var | Default |
|-------|------|---------------|---------|
| `bot_token` | string | `WEBEX_BOT_TOKEN` | (required) |
| `caipe_url` | string | `CAIPE_URL` | `http://caipe-supervisor:8000` |
| `enable_auth` | bool | `WEBEX_INTEGRATION_ENABLE_AUTH` | `false` |
| `auth_token_url` | string | `WEBEX_INTEGRATION_AUTH_TOKEN_URL` | `""` |
| `auth_client_id` | string | `WEBEX_INTEGRATION_AUTH_CLIENT_ID` | `""` |
| `auth_client_secret` | string | `WEBEX_INTEGRATION_AUTH_CLIENT_SECRET` | `""` |
| `auth_scope` | string | `WEBEX_INTEGRATION_AUTH_SCOPE` | `""` |
| `auth_audience` | string | `WEBEX_INTEGRATION_AUTH_AUDIENCE` | `""` |
| `mongodb_uri` | string | `MONGODB_URI` | `""` |
| `mongodb_database` | string | `MONGODB_DATABASE` | `"caipe"` |
| `caipe_ui_base_url` | string | `CAIPE_UI_BASE_URL` | `http://localhost:3000` |
| `langfuse_enabled` | bool | `LANGFUSE_SCORING_ENABLED` | `false` |

### WebexMessage (from Webex API)

Represents an incoming Webex message received via WebSocket.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique message ID |
| `roomId` | string | Space/room where the message was sent |
| `roomType` | string | `"direct"` (1:1) or `"group"` |
| `personId` | string | Sender's person ID |
| `personEmail` | string | Sender's email |
| `text` | string | Plain text content (includes @mention prefix in group spaces) |
| `html` | string | HTML content (if formatted) |
| `files` | list[string] | Attached file URLs (if any) |
| `parentId` | string | Parent message ID (if threaded reply) |
| `created` | datetime | Message creation timestamp |

Source: `webexteamssdk.messages.get(messageId)` after WebSocket notification.

### WebexAttachmentAction (from Webex API)

Represents a card action submission (button click or form submit).

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Action ID |
| `type` | string | Always `"submit"` |
| `messageId` | string | ID of the message containing the card |
| `roomId` | string | Space where the card was posted |
| `personId` | string | Person who submitted the action |
| `inputs` | dict | Key-value pairs from the card form inputs |
| `created` | datetime | Action timestamp |

Source: `webexteamssdk.attachment_actions.get(actionId)` after `cardAction` WebSocket event.

### AuthorizedWebexSpace

Represents a Webex space that has been authorized to use CAIPE. Created via the `@caipe authorize` bot command + CAIPE UI OIDC flow, or by an admin via the Admin Dashboard.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB auto-generated ID |
| `roomId` | string | Webex room ID (unique index) |
| `spaceName` | string (optional) | Display name of the space (fetched from Webex API or user-provided) |
| `authorizedBy` | string | Email of the user who authorized the space |
| `authorizedAt` | datetime | When the space was authorized |
| `status` | string | `"active"` or `"revoked"` |
| `revokedAt` | datetime (optional) | When the space was revoked (if applicable) |
| `revokedBy` | string (optional) | Email of the admin who revoked (if applicable) |

Storage: MongoDB collection `authorized_webex_spaces`. Indexed on `roomId` (unique) and `status`.

State transitions:
- `active` → `revoked` (admin revokes via dashboard, or future admin bot command)
- `revoked` → `active` (re-authorization via `@caipe authorize` flow or admin re-add)

### SpaceAuthorizationCache (in-memory, bot-side)

In-memory TTL cache within the Webex bot process to avoid querying MongoDB on every incoming message.

| Field | Type | Description |
|-------|------|-------------|
| `room_id` | string | Webex room ID (cache key) |
| `is_authorized` | bool | Whether the space is authorized |
| `expires_at` | float | Unix timestamp when the cache entry expires |

TTL: Configurable via `WEBEX_SPACE_AUTH_CACHE_TTL` (default: 300 seconds / 5 minutes).

Cache invalidation: Entries are lazily evicted on access (check `expires_at`). No active invalidation from the UI side — revocations take effect within the TTL window.

## Relationships

```
WebexMessage ──────── belongs to ──────── WebexSpace (roomId)
     │                                          │
     │                                          └── authorized by ── AuthorizedWebexSpace (roomId)
     │                                                                    │
     │                                                                    └── cached in ── SpaceAuthorizationCache
     │
     ├── triggers ──── WebexSession (thread_key = roomId or roomId:parentId)
     │                      │
     │                      └── maps to ── A2A Context (context_id)
     │
     └── may produce ── WebexAttachmentAction (card submission)
                              │
                              └── continues ── A2A Context (via session lookup)
```

## Authorization Flow

```
User @mentions bot in unauthorized space
     │
     ▼
Bot checks SpaceAuthorizationCache
     │
     ├── Cache HIT (not expired) → authorized? → process / deny
     │
     └── Cache MISS or expired
           │
           ▼
     Query MongoDB (authorized_webex_spaces)
           │
           ├── roomId found, status=active → cache TRUE, process message
           │
           └── Not found or status=revoked → cache FALSE, deny message
                                                  │
                                                  ▼
                                        Bot sends denial + instructions
                                                  │
                                                  ▼
                                        User runs "@caipe authorize"
                                                  │
                                                  ▼
                                        Bot sends Adaptive Card with
                                        "Connect to CAIPE" button
                                                  │
                                                  ▼
                                        User clicks → CAIPE UI auth page
                                                  │
                                                  ▼
                                        OIDC SSO → group check → store
                                        AuthorizedWebexSpace in MongoDB
                                                  │
                                                  ▼
                                        Next message: cache miss → DB hit
                                        → authorized → process message
```
