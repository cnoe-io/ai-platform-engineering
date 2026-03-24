# Research: Webex Bot Integration

**Feature**: `098-webex-bot-integration` | **Date**: 2026-03-18

## Research Areas

### 1. Webex WebSocket Connection (jarvis-agent Reference)

**Source**: `/Users/sraradhy/cisco/eti/sre/jarvis-agent/jarvis_agent/webex/utils/webexwebsocket.py`

The jarvis-agent implements a WebSocket-based Webex bot using three components:

1. **`webexteamssdk`** — REST API client for fetching messages, sending replies, managing cards
2. **`websockets`** (>=15.0.1) — Async WebSocket client for real-time events
3. **WDM (Web Device Management)** — Device registration endpoint that provides the WebSocket URL

**Connection flow**:
1. POST to `https://wdm-a.wbx2.com/wdm/api/v1/devices` with device metadata
2. Receive `webSocketUrl` in response
3. Connect via `websockets.connect(webSocketUrl)`
4. Send auth message: `{"type": "authorization", "data": {"token": "Bearer <token>"}}`
5. Loop: `await ws.recv()` → parse JSON → route by event type

**Event routing**:
- `conversation.activity` with `verb: "post"` or `"update"` → fetch full message via REST → call `on_message`
- `conversation.activity` with `verb: "cardAction"` → fetch attachment action → call `on_card`
- `conversation.activity` with `verb: "share"` → store share ID for subsequent update events

**Key implementation detail**: The WebSocket only provides notification of events. The bot must fetch the actual message content via `webexteamssdk.messages.get(messageId)` using the base64 message ID derived from the activity payload. This is required for geo-routing to the correct data center.

**Reconnection**: jarvis-agent uses a simple `while True` loop with `asyncio.sleep(5)` on `ConnectionClosed` or `TimeoutError`. Our implementation will improve this with exponential backoff.

**Security note**: jarvis-agent uses `pickle` to cache device data on disk. We will NOT use pickle (unsafe deserialization risk per codeguard rules). Device info will be cached in-memory only.

### 2. Message Sending Patterns

**Markdown messages**:
```python
webex_api.messages.create(roomId=room_id, markdown="**Bold** and _italic_ text")
```

**Message updates** (for progress):
```python
webex_api.messages.update(messageId=msg_id, roomId=room_id, markdown="Updated content")
```

**Threaded replies**:
```python
webex_api.messages.create(roomId=room_id, parentId=parent_msg_id, markdown="Reply text")
```

**Message deletion** (cleanup):
```python
webex_api.messages.delete(messageId=msg_id)
```

### 3. Adaptive Cards in Webex

**Sending a card**:
```python
webex_api.messages.create(
    roomId=room_id,
    text="Fallback text for clients that cannot render cards",
    attachments=[{
        "contentType": "application/vnd.microsoft.card.adaptive",
        "content": card_payload,
    }],
)
```

**Card schema**: Version 1.3, using `http://adaptivecards.io/schemas/adaptive-card.json`

**Available elements** (used in jarvis-agent):
- `TextBlock` — text display with weight, size, wrapping
- `ColumnSet` / `Column` — multi-column layouts
- `Container` — grouping
- `Input.Text` — text input (single or multiline)
- `Input.ChoiceSet` — dropdown/radio (compact or expanded)
- `ActionSet` / `Action.Submit` — buttons with data payloads
- Styles: `positive`, `destructive`

**Card action handling**: When a user submits a card, a `cardAction` event fires on the WebSocket. The bot fetches the action via `webexteamssdk.attachment_actions.get(actionId)` and reads `action.inputs` (key-value dict from the card form).

### 4. Streaming Alternatives Analysis

| Approach | Description | API Calls | UX Quality | Complexity |
|----------|-------------|-----------|------------|------------|
| Multiple messages | Each SSE event → new message (jarvis-agent) | High | Poor (flood) | Low |
| Single update | One message, updated periodically | Medium | Good | Medium |
| Working + final | "Working..." then one final message | Low | OK (no progress) | Low |
| Hybrid | "Working..." → periodic updates → final | Medium | Good | Medium |

**Selected**: Hybrid approach. Post "Working on it...", update with progress every 3+ seconds, then post final response.

### 5. Shared Component Analysis

> **Decision update (2026-03-18)**: The Slack bot will NOT be modified in this feature. Instead, the platform-agnostic modules will be **copied** into the Webex bot codebase with Webex-specific adaptations. Commonization into a shared `integrations/common/` layer is deferred to a future spec.

Detailed line-by-line analysis of Slack bot files for platform-specificity:

| File | Total LoC | Platform-Agnostic LoC | Slack-Specific LoC | Extraction |
|------|-----------|----------------------|--------------------|----|
| `a2a_client.py` | 319 | 317 | 2 (header) | Move, parameterize header |
| `event_parser.py` | 290 | 290 | 0 | Move as-is |
| `oauth2_client.py` | 85 | 80 | 5 (env names) | Move, add prefix param |
| `session_manager.py` | 120 | 120 | 0 | Move as-is |
| `mongodb_session.py` | 140 | 135 | 5 (collection) | Move, parameterize collection |
| `langfuse_client.py` | 50 | 50 | 0 | Move as-is |
| `hitl_handler.py` | 200 | 80 (models) | 120 (rendering) | Split models from rendering |
| **Total** | **1204** | **1072 (89%)** | **132 (11%)** | |

### 6. Webex vs Slack Feature Mapping

| Feature | Slack | Webex | Notes |
|---------|-------|-------|-------|
| Real-time events | Socket Mode (WebSocket) | WDM WebSocket | Both use WebSocket |
| Message format | Block Kit + mrkdwn | Markdown + Adaptive Cards | Different formatting systems |
| Streaming | `chat_startStream`/`appendStream`/`stopStream` | N/A | Webex: use message updates |
| Threading | `thread_ts` | `parentId` | Similar concept, different field |
| @mention detection | Event includes mention data | Bot only gets mentioned messages in group | Platform handles filtering |
| Interactive forms | Block Kit modals/actions | Adaptive Cards + attachment_actions | Different but equivalent |
| Message update | `chat_update` | `messages.update()` | Both supported |
| Typing indicator | `assistant_threads_setStatus` | N/A | Webex has no equivalent |
| DM detection | `channel_type == "im"` | `roomType == "direct"` | Different field names |

### 7. CAIPE UI OAuth Flow for Space Authorization

**Research question**: How should the bot-initiated space authorization flow integrate with the existing CAIPE UI authentication?

**Findings from CAIPE UI codebase**:

1. **Existing auth stack**: NextAuth.js with OIDC provider, JWT strategy, PKCE + state checks. Session exposes `accessToken`, `idToken`, `isAuthorized`, `role`, `canViewAdmin`, group-based RBAC.

2. **Existing admin patterns**: Admin dashboard at `/admin` with tabs (Users, Teams, Skills, etc.). Access controlled via `requireAdmin` (write) and `requireAdminView` (read-only). API routes use `withAuth(request, handler)` middleware.

3. **Existing MongoDB usage**: Collections for `users`, `conversations`, `messages`, `user_settings`, `agent_configs`, `policies`, etc. Connection via singleton in `ui/src/lib/mongodb.ts`. Collections auto-indexed on first access.

4. **API route patterns**: All admin API routes under `/api/admin/*`, using `withAuth` + `withErrorHandler`, validation helpers (`validateRequired`, `validateEmail`, `validateUUID`), pagination (`getPaginationParams`, `paginatedResponse`).

**Design decision — Authorization endpoint**:

The bot sends a "Connect to CAIPE" link pointing to:
```
<CAIPE_UI_BASE_URL>/api/admin/integrations/webex/authorize?roomId=<roomId>
```

This endpoint:
1. Checks the user has a valid OIDC session (via `getServerSession(authOptions)`)
2. If not authenticated → redirects to `/login` with a return URL
3. If authenticated → validates OIDC group membership (same groups as admin access)
4. If authorized → stores `AuthorizedWebexSpace` document in MongoDB with `status: 'active'`
5. Returns a success page/redirect confirming the space is now authorized

**Why this approach**:
- Reuses the existing OIDC SSO flow completely — no new auth infrastructure
- The user is already familiar with the CAIPE UI login experience
- Group-based access control is already implemented and configured
- MongoDB collection patterns are well established in the codebase
- The admin dashboard tab for managing spaces follows the existing tab pattern exactly

**Rejected alternatives**:
- Webex OAuth integration: Would require registering a Webex Integration (not just Bot) on developer.webex.com and implementing a separate OAuth flow. Unnecessary complexity since we already have OIDC auth.
- Static env-var allowlist: Too rigid for production use; no self-service path; requires bot restart to update.

### 8. Dependencies Comparison

| Library | Slack Bot | Webex Bot | Shared |
|---------|-----------|-----------|--------|
| `slack_bolt` | Yes | No | No |
| `slack_sdk` | Yes | No | No |
| `websockets` | No | Yes | No |
| `webexteamssdk` | No | Yes | No |
| `requests` | Yes | Yes | Yes (common) |
| `loguru` | Yes | Yes | Yes (common) |
| `pydantic` | Yes | Yes | Yes (common) |
| `pymongo` | Yes | Yes | Yes (common) |
| `pyyaml` | Yes | Maybe | Maybe |
| `langfuse` | Yes | Yes | Yes (common) |
