# Shared Conversation API

> **Branch:** `prebuild/feat/shared-conversation-api`
> **Base:** `release/0.4.0`
> **Status:** In Progress

## Problem

The Web UI and Slack bot create conversations differently:

- **Web UI**: Generates a random UUID v4 client-side, creates a MongoDB document via `POST /api/chat/conversations` (cookie auth only, hardcoded `client_type: 'ui'`).
- **Slack bot**: Generates a deterministic UUID v5 from `thread_ts`, sends it directly to the DA backend. No MongoDB conversation document is ever created. Slack conversations are invisible to the web UI.

Both paths use the same DA backend, and the conversation ID becomes the LangGraph `thread_id`. But without a shared conversation record, there's no unified view of conversations across clients.

## Goal

A single `POST /api/chat/conversations` endpoint that **both** the web UI and Slack bot call to create conversations. The server owns ID generation, stores a consistent document, and supports create-or-return (upsert) semantics.

## Design

### Endpoint: `POST /api/chat/conversations`

**Auth:** `getAuthFromBearerOrSession` (supports Bearer JWT for service-to-service + session cookie for browser)

**Request body:**

```ts
interface CreateConversationRequest {
  title: string;                          // required
  client_type: "webui" | "slack";         // required, enum-validated
  agent_id?: string;                      // optional, builds participants
  owner_id?: string;                      // optional, see trust note below
  metadata?: Record<string, unknown>;     // optional, arbitrary key/values
  tags?: string[];                        // optional
}
```

Key rules:
- **No `id` from caller** — the server generates a UUID v4 and owns ID generation.
- **`client_type`** is validated against enum `["webui", "slack"]`. Any other value is rejected with a `400` and a helpful message listing valid values.
- **`metadata`** is an arbitrary `Record<string, unknown>`. The client decides what to put here. Slack will send `{ thread_ts, channel_id, channel_name }`. The web UI can send whatever it wants. No hardcoded keys.
- **`owner_id`**: If provided, used as-is. If omitted, falls back to `user.email` from auth. See risk note.

**Upsert (create-or-return):**

If a conversation already exists with matching `metadata.thread_ts` + `owner_id`, return the existing document instead of creating a new one. This covers the Slack case where the same thread sends multiple messages.

**Response:**

```ts
// 201 Created (new conversation)
{ conversation: { _id, title, client_type, owner_id, ... }, created: true }

// 200 OK (existing conversation returned)
{ conversation: { _id, title, client_type, owner_id, ... }, created: false }
```

### Conversation Document (MongoDB)

```ts
interface Conversation {
  _id: string;                            // server-generated UUID v4
  title: string;
  client_type: "webui" | "slack";         // TOP-LEVEL (promoted from metadata)
  owner_id: string;                       // user email or service identity
  participants: Participant[];
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, unknown>;      // arbitrary client metadata
  sharing: { ... };                       // sharing settings
  tags: string[];
  is_archived: boolean;
  is_pinned: boolean;
}
```

**Backward compatibility:** Older documents have `metadata.client_type: 'ui'` but no top-level `client_type`. Queries treat missing `client_type` as `"webui"`.

### Endpoint: `GET /api/chat/conversations`

- Remove the phantom `source: { $ne: 'slack' }` filter (dead code — `source` was never written).
- Add `client_type` as a query parameter: `?client_type=webui`, `?client_type=slack`, or omit for all.
- Backward compat: documents without top-level `client_type` are treated as `"webui"`.

### `owner_id` Trust Model

> **⚠️ RISK:** Any Bearer-authenticated caller can set `owner_id` to any email.
> This is accepted for now to unblock the Slack integration. The Slack bot
> knows the user's email (via Slack `users.info` API) and sends it as `owner_id`.
>
> **Future mitigation:** Implement a service account allowlist — only specific
> OAuth2 client IDs (identified from JWT `sub` claim) are permitted to set
> `owner_id` on behalf of users. Regular browser sessions should never be
> allowed to override `owner_id`.

## Implementation Plan

### Phase 1: API Changes

#### 1.1 Update types (`ui/src/types/mongodb.ts`)
- Add `ClientType = "webui" | "slack"` type
- Add `client_type: ClientType` to `Conversation` interface (top-level)
- Update `CreateConversationRequest`: remove `id`, add `client_type`, `owner_id?`, `metadata?`
- Keep `metadata.client_type` on the interface for backward compat reads

#### 1.2 Update `POST /api/chat/conversations` (`ui/src/app/api/chat/conversations/route.ts`)
- Switch `withAuth` → `getAuthFromBearerOrSession`
- Validate `client_type` against enum, reject with helpful 400 if invalid
- Generate UUID v4 server-side (remove `body.id || uuidv4()` → always `uuidv4()`)
- Accept `owner_id` from body (with risk comment), fallback to `user.email`
- Accept `metadata` as `Record<string, unknown>`
- Set `client_type` as top-level field
- Implement upsert: check for existing conversation matching `metadata.thread_ts` + `owner_id` before insert
- Return `{ conversation, created: boolean }` with appropriate status code (201 or 200)

#### 1.3 Update `GET /api/chat/conversations` (`ui/src/app/api/chat/conversations/route.ts`)
- Remove `source: { $ne: 'slack' }` filter
- Add `client_type` query param filter
- Handle backward compat for docs without top-level `client_type`

### Phase 2: Web UI Changes

#### 2.1 Update API client (`ui/src/lib/api-client.ts`)
- Update `createConversation()` to match new request/response shape

#### 2.2 Update Zustand store (`ui/src/store/chat-store.ts`)
- `createConversation()` becomes async — awaits server response to get the server-generated ID
- Remove `generateId()` call for conversation creation
- Pass `client_type: "webui"` in the request

#### 2.3 Update DynamicAgentChatPanel (`ui/src/components/chat/DynamicAgentChatPanel.tsx`)
- `submitMessage` must await conversation creation before starting the stream
- Currently fire-and-forget; needs to block on the API response (~<50ms latency for MongoDB insert)

#### 2.4 Update conversation list UI
- Add `client_type` filter to conversation sidebar
- Show a Slack icon/badge on Slack-originated conversations
- Wire up `client_type` query param to the API call

### Phase 3: Slack Bot Changes

#### 3.1 Add `create_conversation()` to SSE client (`ai_platform_engineering/integrations/slack_bot/sse_client.py`)
- New method: `POST {CAIPE_API_URL}/api/chat/conversations`
- Pass `client_type: "slack"`, `owner_id`, `agent_id`, `title`, `metadata: { thread_ts, channel_id, channel_name, ... }`
- Handle `created: true` (new) vs `created: false` (existing) responses
- Return the conversation `_id`

#### 3.2 Update Slack handlers (`ai_platform_engineering/integrations/slack_bot/app.py`)
- Call `create_conversation()` before `stream_chat()` in all three modes (@mention, Q&A, DM)
- Use the server-returned `_id` as `conversation_id` for `stream_chat()`
- Remove/deprecate `thread_ts_to_conversation_id()` (or keep as fallback)

### Phase 4: Cleanup

- Remove `metadata.client_type` writes (replaced by top-level `client_type`)
- Add MongoDB index on `{ "metadata.thread_ts": 1, owner_id: 1 }` for upsert performance
- Migration note: existing documents retain `metadata.client_type` — no backfill needed, queries handle both

## Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `ui/src/types/mongodb.ts` | 1.1 | `ClientType`, updated `Conversation`, updated `CreateConversationRequest` |
| `ui/src/app/api/chat/conversations/route.ts` | 1.2, 1.3 | Auth switch, upsert, `client_type` top-level, GET filter |
| `ui/src/lib/api-client.ts` | 2.1 | Updated request/response types |
| `ui/src/store/chat-store.ts` | 2.2 | Async `createConversation`, no client-side ID |
| `ui/src/components/chat/DynamicAgentChatPanel.tsx` | 2.3 | Await conversation creation |
| Conversation sidebar component(s) | 2.4 | `client_type` filter, Slack badge |
| `ai_platform_engineering/integrations/slack_bot/sse_client.py` | 3.1 | `create_conversation()` method |
| `ai_platform_engineering/integrations/slack_bot/app.py` | 3.2 | Call before streaming, use returned ID |

## Decisions

1. **Default filter for conversation list**: Return ALL conversations (no `client_type` filter by default). Users see both webui and Slack conversations in the sidebar.
2. **Conversation title for Slack**: First message truncated.
3. **Thread context deduplication**: Separate follow-up task. For now, focus only on conversation_id unification.
