# Implementation Plan: Webex Bot Integration

**Branch**: `098-webex-bot-integration` (on `prebuild/feat/webex-bot-integration`) | **Date**: 2026-03-18 | **Updated**: 2026-03-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/098-webex-bot-integration/spec.md`

## Summary

Add a Webex bot integration that connects to the Webex platform via WebSocket (using the jarvis-agent WDM + `websockets` pattern), forwards user messages to the CAIPE supervisor via the A2A protocol, and streams responses back to the user in Webex spaces. The Webex bot includes its own copies of the A2A client, event parser, session manager, and OAuth2 client modules (adapted from the Slack bot) alongside Webex-specific adapters for message delivery, Adaptive Card formatting, and WebSocket-based message reception. **The Slack bot is NOT modified in this feature** — commonization into a shared layer is deferred to a future spec.

**Authorization** is two-layered:
1. **Bot-to-supervisor auth**: OAuth2 client credentials / shared key, identical to the Slack bot.
2. **Space-level authorization**: Dynamic, MongoDB-backed authorized space registry. Spaces are authorized via (a) a bot command (`@caipe authorize`) that links the user to the CAIPE UI for OIDC authentication, or (b) an admin dashboard page in the CAIPE UI. 1:1 DMs are allowed by default; a future OIDC group-based user check is designed as a pluggable interface.

The jarvis-agent codebase (`/Users/sraradhy/cisco/eti/sre/jarvis-agent`) serves as the primary reference for the Webex WebSocket connection, WDM device registration, and Adaptive Card patterns.

## Technical Context

**Language/Version**: Python 3.11+
**Primary Dependencies**: `websockets` (>=15.0.1), `webexteamssdk`, `requests`, `loguru`, `pydantic`, `pymongo`
**Storage**: MongoDB (session persistence) or in-memory fallback
**Testing**: pytest
**Target Platform**: Linux container (Docker/Kubernetes)
**Project Type**: Integration service (WebSocket client + HTTP client to supervisor)
**Performance Goals**: Response latency within 2s of Slack bot; 50 concurrent users; WebSocket uptime 99.5%; space auth check <50ms (cached)
**Constraints**: No public endpoint required (WebSocket pull model); unified auth with Slack bot; Slack bot MUST NOT be modified; space auth stored in MongoDB with 5-min TTL cache
**Scale/Scope**: ~20 new files (bot + UI), ~6 modified files (UI + deployment only — no Slack bot changes), 1 new Helm subchart, 1 new Dockerfile, 1 new MongoDB collection, 1 new UI admin tab, 1 new API route

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| I. Specs as Source of Truth | PASS | Spec exists at `docs/docs/specs/098-webex-bot-integration/spec.md` |
| II. Agent-First Architecture | PASS | Webex bot is a client integration, not a new agent. Reuses existing supervisor and A2A agents |
| III. MCP Server Pattern | PASS | No new MCP servers. Bot communicates with supervisor via A2A protocol |
| IV. LangGraph-Based Agents | N/A | Webex bot is not an agent; it is a protocol client |
| V. A2A Protocol Compliance | PASS | Uses `message/stream` JSON-RPC over HTTP with SSE, same as Slack bot |
| VII. Test-First Quality Gates | PASS | Tests planned for shared components, Webex message handling, and card formatting |
| VIII. Structured Documentation | PASS | Spec, plan, and ADR will be created |
| IX. Security by Default | PASS | No secrets in source; OAuth2/shared key auth; env var injection; WebSocket auth via Bearer token |
| X. Simplicity / YAGNI | PASS | Copies needed modules into Webex bot rather than extracting a shared layer (Rule of Three not yet met — only 2 integrations). Commonization deferred to future spec. No Slack bot changes |

No violations. Complexity Tracking section not needed.

**Post-design re-check** (after authorization additions):
- IX. Security by Default: PASS — OIDC SSO for space authorization; group membership validation; no new secrets; MongoDB-backed with cache fallback
- X. Simplicity / YAGNI: PASS — Space authorization is a hard requirement (FR-013, FR-016-019); admin dashboard reuses existing tab/API patterns; in-memory TTL cache is the simplest viable solution for the <50ms auth check constraint

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/098-webex-bot-integration/
├── spec.md              # Feature specification (complete)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
└── checklists/
    └── requirements.md  # Spec quality checklist (complete)
```

### Source Code (repository root)

```text
# Slack bot — UNCHANGED (no modifications in this feature)
# ai_platform_engineering/integrations/slack_bot/ — NOT TOUCHED

# Webex bot (NEW — self-contained, with its own copies of needed modules)
ai_platform_engineering/integrations/webex_bot/
├── __init__.py
├── app.py                     # Entry point: WebSocket setup, message routing, card action routing
├── requirements.txt           # websockets, webexteamssdk, requests, loguru, pydantic, pymongo
├── Makefile                   # test, lint targets
├── webex_websocket.py         # WebSocket client (based on jarvis-agent webexwebsocket.py pattern)
├── a2a_client.py              # COPIED from slack_bot, adapted: X-Client-Source=webex-bot, client_source param
├── event_parser.py            # COPIED from slack_bot (platform-agnostic, no changes needed)
├── oauth2_client.py           # COPIED from slack_bot, adapted: WEBEX_INTEGRATION_AUTH_* env prefix
├── session_manager.py         # COPIED from slack_bot (platform-agnostic, no changes needed)
├── mongodb_session.py         # COPIED from slack_bot, adapted: webex_sessions collection name
├── langfuse_client.py         # COPIED from slack_bot (platform-agnostic, no changes needed)
├── utils/
│   ├── __init__.py
│   ├── ai.py                  # stream_a2a_response_webex() — A2A streaming with Webex message delivery
│   ├── webex_formatter.py     # Markdown + Adaptive Card formatting (execution plan, progress, errors)
│   ├── webex_context.py       # Space history retrieval, message text extraction
│   ├── cards.py               # Adaptive Card builders (feedback, HITL forms, user input, authorize)
│   ├── hitl_handler.py        # HITL form rendering (Adaptive Cards) + card action processing
│   ├── config.py              # Webex-specific config loading from env vars
│   ├── config_models.py       # Pydantic models for Webex bot configuration
│   └── space_auth.py          # Space authorization: MongoDB lookup with TTL cache, authorize command handler
└── tests/
    ├── __init__.py
    ├── test_app.py
    ├── test_webex_websocket.py
    ├── test_ai.py
    ├── test_webex_formatter.py
    ├── test_cards.py
    └── test_space_auth.py

# Deployment
build/
└── Dockerfile.webex-bot                      # NEW: Python 3.13-slim, copy webex_bot (self-contained)

docker-compose.yaml                            # MODIFY: add webex-bot service
docker-compose.dev.yaml                        # MODIFY: add webex-bot dev service

charts/ai-platform-engineering/charts/webex-bot/  # NEW: Helm subchart
├── Chart.yaml
├── values.yaml
├── templates/
│   ├── _helpers.tpl
│   ├── deployment.yaml
│   ├── configmap.yaml
│   ├── external-secret.yaml
│   └── serviceaccount.yaml

charts/ai-platform-engineering/
├── Chart.yaml                                 # MODIFY: add webex-bot dependency
└── values.yaml                                # MODIFY: add webex-bot config block

deploy/secrets-examples/
└── webex-secret.yaml.example                  # NEW: WEBEX_BOT_TOKEN secret template

.env.example                                   # MODIFY: add WEBEX_INTEGRATION_* env vars

# CAIPE UI — Space Authorization (NEW + MODIFY)
ui/src/app/api/admin/integrations/webex/
├── spaces/route.ts                            # NEW: GET (list), POST (add) authorized spaces
├── spaces/[id]/route.ts                       # NEW: DELETE (revoke) authorized space
└── authorize/route.ts                         # NEW: GET (auth page redirect), POST (authorize space after OIDC)

ui/src/app/(app)/admin/
└── (components in admin page.tsx)             # MODIFY: add "Integrations" or "Webex Spaces" tab

ui/src/types/mongodb.ts                        # MODIFY: add AuthorizedWebexSpace type
ui/src/lib/mongodb.ts                          # MODIFY: add authorized_webex_spaces collection + indexes

# CI
.github/workflows/                             # MODIFY: add webex-bot Dockerfile trigger path
```

**Structure Decision**: The Webex bot is a standalone, self-contained integration service under `ai_platform_engineering/integrations/webex_bot/`. It includes its own copies of the needed modules (A2A client, event parser, session manager, OAuth2 client, MongoDB session, Langfuse client) adapted from the Slack bot with Webex-specific configuration (env var prefixes, collection names, client source header). **The Slack bot is NOT modified.** A future commonization spec will extract these into a shared `integrations/common/` layer when a third integration triggers the Rule of Three.

## Phase 0: Research

### Key Findings

**Finding 1: WebSocket Connection via WDM (from jarvis-agent)**

The jarvis-agent codebase demonstrates a proven pattern for connecting to Webex via WebSocket without webhooks or public endpoints. The flow is:

1. Register a "device" with Webex WDM (`https://wdm-a.wbx2.com/wdm/api/v1/devices`)
2. Receive a `webSocketUrl` from the device info
3. Connect to the WebSocket URL using the `websockets` library
4. Send an authorization message with `Bearer <access_token>`
5. Receive `conversation.activity` events with verbs: `post`, `update`, `share`, `cardAction`
6. Fetch full message details via the Webex REST API using the base64 message ID
7. Reconnect on `ConnectionClosed` or `TimeoutError` with a 5-second backoff

This is preferable to the `webex_bot` library because:
- The jarvis-agent pattern is already proven in production at Cisco
- It gives us full control over the WebSocket lifecycle and reconnection
- The `webex_bot` library is "only sporadically maintained" per its README
- We can adapt the WDM pattern to our needs without depending on a third-party framework

**Decision**: Use the jarvis-agent WDM + `websockets` + `webexteamssdk` pattern directly, adapted for the CAIPE architecture.

**Finding 2: Webex Has No Native Streaming API (Unlike Slack)**

Slack provides `chat_startStream` / `chat_appendStream` / `chat_stopStream` for real-time message streaming. Webex has no equivalent. The options for conveying streamed A2A responses are:

| Approach | Pros | Cons |
|----------|------|------|
| **A. Multiple messages** (jarvis-agent pattern) | Simple; each SSE event = new Webex message | Noisy; floods the space; no consolidation |
| **B. Single message + in-place updates** | Clean UX; one message updated progressively | Requires `messages.update()` calls; may hit rate limits |
| **C. Initial "Working..." + final consolidated message** | Clean; low API calls; reliable | No incremental progress visible to user |
| **D. Hybrid: "Working..." + periodic updates + final** | Good UX; moderate API calls; shows progress | More complex; needs throttling |

**Decision**: Use **Approach D (Hybrid)**. Post an initial "Working on it..." message, then periodically update it with progress (execution plan, tool notifications), and finally replace with the complete response. This mirrors the Slack bot's non-streaming path (for bot users) which already uses `chat_postMessage` → throttled `chat_update`. The existing `ThrottlerConfig` concept (min/max intervals, retry backoff) will be adapted for Webex message updates via `webexteamssdk.messages.update()`.

**Finding 3: Adaptive Cards for Structured Content**

Jarvis-agent demonstrates Adaptive Card patterns for:
- Feedback cards (thumbs up/down → options → text input)
- User input cards (dynamic forms from agent input_fields)
- Card action handling via `attachment_actions.get()`

The Webex Adaptive Card schema (`http://adaptivecards.io/schemas/adaptive-card.json`, version 1.3) supports:
- `TextBlock`, `ColumnSet`, `Container` for layout
- `Input.Text`, `Input.ChoiceSet` for user input
- `Action.Submit` with `data` payloads
- `ActionSet` for button groups

**Decision**: Build Webex Adaptive Card builders for: execution plan display, HITL forms (mapped from A2A `input-required` events), and feedback cards. Use the jarvis-agent `cards.py` patterns as a starting point, extended for the CAIPE-specific event types.

**Finding 4: Message Threading in Webex**

Webex threading model differs from Slack:
- Webex uses `parentId` on a message to create a thread (reply to a specific message)
- In 1:1 spaces, all messages are in a single conversation (no threading needed)
- In group spaces, the bot's reply can use `parentId` to thread under the user's message

For session mapping: use `roomId` as the primary key (like jarvis-agent uses it as `chat_id`). For multi-turn conversations within a space, use `roomId` as the conversation identifier. If threading is used (group spaces), use `roomId + parentId` as the thread key.

**Decision**: Use `roomId` as the session key for 1:1 spaces. For group spaces, use `roomId + parentMessageId` to support distinct conversation threads. This maps directly to the existing `SessionManager` interface where `thread_ts` (Slack) becomes the Webex thread key.

**Finding 5: Common Components Analysis**

| Component | Current Location (Slack bot) | Platform-Specific? | Extraction Effort |
|-----------|------------------------------|---------------------|-------------------|
| `a2a_client.py` | `slack_bot/a2a_client.py` | Only `X-Client-Source: slack-bot` header | Low — parameterize header |
| `event_parser.py` | `slack_bot/utils/event_parser.py` | No — pure A2A parsing | Trivial — move as-is |
| `oauth2_client.py` | `slack_bot/utils/oauth2_client.py` | Only env var names (`SLACK_INTEGRATION_AUTH_*`) | Low — add generic env fallback |
| `session_manager.py` | `slack_bot/utils/session_manager.py` | No — abstract interface | Trivial — move as-is |
| `mongodb_session.py` | `slack_bot/utils/mongodb_session.py` | Collection name `slack_sessions` | Low — parameterize collection |
| `langfuse_client.py` | `slack_bot/utils/langfuse_client.py` | No | Trivial — move as-is |
| HITL models | `slack_bot/utils/hitl_handler.py` | Data models are generic; rendering is Slack-specific | Medium — split models from rendering |

**Decision**: Copy all platform-agnostic components into the Webex bot codebase with Webex-specific adaptations (env prefix, collection name, client source header). The Slack bot is **NOT modified**. Commonization into a shared `integrations/common/` layer is deferred to a future spec when a third integration (e.g., Microsoft Teams) triggers the Rule of Three.

## Phase 1: Design

### Data Model

See [data-model.md](./data-model.md) for entity definitions (to be created).

Key entities:

- **WebexSession**: `thread_key` (roomId or roomId+parentId) → `context_id`, `trace_id` — uses the shared `SessionStore` interface
- **WebexConfig**: Bot token, supervisor URL, auth settings, MongoDB URI — loaded from env vars with `WEBEX_INTEGRATION_` prefix
- **WebexDeviceInfo**: WDM device registration data — cached in memory (not pickled to disk like jarvis-agent)

### Component Design

#### 1. `webex_websocket.py` — WebSocket Client (adapted from jarvis-agent)

Based on `jarvis_agent/webex/utils/webexwebsocket.py` with improvements:

```python
class WebexWebSocketClient:
    def __init__(self, access_token: str, on_message, on_card, on_connect=None, on_disconnect=None)
    def run(self) -> None                    # Blocking, runs event loop
    async def _connect_and_listen(self) -> None
    async def _run_forever(self) -> None     # Reconnect loop with exponential backoff (5s → 10s → 20s → 60s max)
    def _process_message(self, msg: dict) -> None
    def _get_device_info(self) -> dict       # WDM registration (in-memory cache, no pickle)
    def _get_base64_message_id(self, activity: dict) -> str  # Geo-routed message fetch
```

Improvements over jarvis-agent:
- Exponential backoff on reconnect (jarvis-agent uses fixed 5s)
- Lifecycle callbacks (`on_connect`, `on_disconnect`) for health monitoring
- In-memory device cache (no `pickle` — avoids deserialization security concerns per codeguard rules)
- Structured logging with `loguru`
- Exception handling per message (isolate failures)

#### 2. `app.py` — Entry Point

```python
def main():
    # 1. Load config from env
    config = WebexConfig.from_env()
    
    # 2. Init auth client (OAuth2 or shared key — same as Slack bot)
    auth_client = None
    if config.enable_auth:
        auth_client = OAuth2ClientCredentials.from_env(prefix="WEBEX_INTEGRATION_AUTH")
    
    # 3. Init shared components
    a2a_client = A2AClient(config.caipe_url, client_source="webex-bot", auth_client=auth_client)
    session_manager = SessionManager()  # MongoDB or in-memory (auto-detected)
    
    # 4. Init Webex API for sending messages
    webex_api = WebexTeamsAPI(access_token=config.bot_token)
    
    # 5. Define handlers
    def handle_message(message_obj): ...
    def handle_card(action_obj): ...
    
    # 6. Start WebSocket client
    ws_client = WebexWebSocketClient(
        access_token=config.bot_token,
        on_message=handle_message,
        on_card=handle_card,
    )
    ws_client.run()
```

Message handler flow:
1. Skip messages from self (`personEmail in my_emails`)
2. Extract text (strip @mention in group spaces)
3. Determine thread key (`roomId` for 1:1, `roomId:parentId` for threaded group)
4. Look up or create session (context_id) via `session_manager`
5. Call `stream_a2a_response_webex()` with A2A client and Webex API

#### 3. `utils/ai.py` — Webex Streaming Response

```python
def stream_a2a_response_webex(
    a2a_client: A2AClient,
    webex_api: WebexTeamsAPI,
    room_id: str,
    message_text: str,
    user_email: str,
    context_id: Optional[str] = None,
    session_manager: Optional[SessionManager] = None,
    parent_id: Optional[str] = None,
) -> Optional[Dict]:
```

Flow (Hybrid approach — Approach D):
1. Post "Working on it..." message to room (with `parentId` if threaded)
2. Store `working_message_id` for later updates
3. Stream events from `a2a_client.send_message_stream()`
4. Parse each event via shared `parse_event()`
5. Route by event type:
   - `TASK`: Store context_id, trace_id in session
   - `EXECUTION_PLAN`: Update working message with plan summary
   - `TOOL_NOTIFICATION_START/END`: Update working message with tool status
   - `STREAMING_RESULT`: Accumulate text (Webex has no `appendStream`)
   - `FINAL_RESULT` / `PARTIAL_RESULT`: Capture final text
   - `CAIPE_FORM` (input-required): Send Adaptive Card for HITL
6. On completion: delete working message, post final response as markdown
7. Post feedback card (Adaptive Card with thumbs up/down)

Throttling: Use `webex_api.messages.update()` with a 3-second minimum interval to avoid rate limits. Track `last_update_time` and buffer content between updates.

#### 4. `utils/webex_formatter.py` — Message Formatting

```python
def format_execution_plan(steps: List[Dict]) -> str          # Markdown list of plan steps with status emoji
def format_tool_notification(tool_name: str, status: str) -> str  # "🔧 Calling tool_name..."
def format_progress_message(plan: str, current_tool: str) -> str  # Combined progress for message update
def format_error_message(error: str) -> str                   # Error markdown
def split_long_message(text: str, max_length: int = 7000) -> List[str]  # Webex max ~7439 chars per message
```

Webex supports Markdown natively in messages. No Block Kit equivalent needed for text — just markdown. Structured content (plans, HITL) uses Adaptive Cards.

#### 5. `utils/cards.py` — Adaptive Card Builders

Based on jarvis-agent `cards.py`, extended for CAIPE events:

```python
def send_card(webex_api, room_id: str, card: dict, parent_id: str = None) -> object
def create_feedback_card() -> dict                                    # 👍/👎 buttons
def create_hitl_form_card(form_data: HITLForm) -> dict               # Dynamic form from A2A input-required
def create_execution_plan_card(steps: List[Dict]) -> dict            # Plan steps with status
def create_user_input_card(input_fields: List[Dict]) -> dict         # From jarvis-agent pattern
def create_error_card(error_message: str) -> dict                    # Error display
```

#### 6. `utils/hitl_handler.py` — HITL Card Action Processing

```python
class WebexHITLHandler:
    def __init__(self, a2a_client: A2AClient, session_manager: SessionManager)
    def handle_card_action(self, action_obj, webex_api) -> None
    def _extract_form_values(self, inputs: dict) -> dict
    def _submit_response(self, room_id: str, values: dict, context_id: str) -> None
```

Maps Webex `attachment_actions` data to A2A user messages, using HITL data models defined within the Webex bot's own `hitl_handler.py`.

#### 7. `utils/space_auth.py` — Space Authorization

```python
class SpaceAuthorizationManager:
    """Checks whether a Webex space is authorized to use CAIPE.
    
    Uses MongoDB as the source of truth with an in-memory TTL cache
    to avoid querying on every message.
    """
    def __init__(self, mongodb_uri: str, database: str = "caipe", cache_ttl: int = 300):
        self._collection = None  # authorized_webex_spaces collection
        self._cache: Dict[str, Tuple[bool, float]] = {}  # room_id → (is_authorized, expiry_ts)
        self._cache_ttl = cache_ttl
    
    def is_authorized(self, room_id: str) -> bool:
        """Check cache first, then MongoDB. Returns True if space is authorized."""
    
    def _check_mongodb(self, room_id: str) -> bool:
        """Query authorized_webex_spaces collection for room_id with status='active'."""
    
    def invalidate_cache(self, room_id: str) -> None:
        """Remove a specific room from cache (called on revocation)."""


def handle_authorize_command(
    webex_api,
    room_id: str,
    user_email: str,
    caipe_ui_base_url: str,
) -> None:
    """Handle '@caipe authorize' command.
    
    Sends an Adaptive Card with a 'Connect to CAIPE' button that links
    to the CAIPE UI authorization endpoint.
    """
    card = create_authorize_card(room_id, caipe_ui_base_url)
    send_card(webex_api, room_id, card)
```

Authorization flow in `app.py` message handler:
1. If `roomType == "direct"` → skip space auth (1:1 always allowed in v1)
2. If message text matches `authorize` command → call `handle_authorize_command()`
3. Otherwise → call `space_auth_manager.is_authorized(room_id)`
   - If `True` → proceed to process message
   - If `False` → reply with denial message + instructions

#### 8. CAIPE UI — Space Authorization API & Admin

**New API routes** (following existing `withAuth` + `requireAdmin` patterns):

```typescript
// ui/src/app/api/admin/integrations/webex/spaces/route.ts
// GET — List authorized spaces (requireAdminView)
// POST — Add a space by room ID (requireAdmin)

// ui/src/app/api/admin/integrations/webex/spaces/[id]/route.ts
// DELETE — Revoke authorization (requireAdmin)

// ui/src/app/api/admin/integrations/webex/authorize/route.ts
// GET — Authorization page: validates OIDC session, shows confirmation UI
// POST — Completes authorization: stores room ID in MongoDB after OIDC validation
```

**MongoDB collection** (`authorized_webex_spaces`):
```typescript
interface AuthorizedWebexSpace {
  _id: ObjectId;
  roomId: string;        // Webex room ID (unique index)
  spaceName?: string;    // Display name (fetched from Webex API or user-provided)
  authorizedBy: string;  // Email of user who authorized
  authorizedAt: Date;    // Timestamp
  status: 'active' | 'revoked';
  revokedAt?: Date;
  revokedBy?: string;
}
```

**Admin Dashboard** — Add a new "Integrations" tab (or "Webex Spaces" sub-tab) to the existing admin page (`ui/src/app/(app)/admin/page.tsx`):
- Table with columns: Space Name, Room ID, Authorized By, Date, Actions (Revoke)
- "Add Space" button (form with room ID input)
- Search and pagination (reusing existing `getPaginationParams`/`paginatedResponse` patterns)

#### 9. Webex A2A Client (copied from Slack bot)

The Webex bot's `a2a_client.py` is copied from the Slack bot's `a2a_client.py` with the `X-Client-Source` header changed to `"webex-bot"`:

```python
class A2AClient:
    def __init__(self, base_url: str, timeout: int = 300, 
                 channel_id: Optional[str] = None, auth_client=None,
                 client_source: str = "webex-bot"):
        self.client_source = client_source
    
    def _get_headers(self, accept="application/json") -> Dict:
        headers = {
            "Content-Type": "application/json",
            "Accept": accept,
            "X-Client-Source": self.client_source,
        }
        # ... rest unchanged from Slack bot
```

#### 10. Webex OAuth2 Client (copied from Slack bot)

The Webex bot's `oauth2_client.py` is copied from the Slack bot's `oauth2_client.py` with the env var prefix changed to `WEBEX_INTEGRATION_AUTH_*`:

```python
class OAuth2ClientCredentials:
    @classmethod
    def from_env(cls, prefix: str = "WEBEX_INTEGRATION_AUTH") -> "OAuth2ClientCredentials":
        return cls(
            token_url=os.environ.get(f"{prefix}_TOKEN_URL") or os.environ.get("OAUTH2_TOKEN_URL", ""),
            client_id=os.environ.get(f"{prefix}_CLIENT_ID") or os.environ.get("OAUTH2_CLIENT_ID", ""),
            client_secret=os.environ.get(f"{prefix}_CLIENT_SECRET") or os.environ.get("OAUTH2_CLIENT_SECRET", ""),
            scope=os.environ.get(f"{prefix}_SCOPE") or os.environ.get("OAUTH2_SCOPE"),
            audience=os.environ.get(f"{prefix}_AUDIENCE") or os.environ.get("OAUTH2_AUDIENCE"),
        )
```

The Slack bot continues to use `SLACK_INTEGRATION_AUTH_*` env vars unchanged.

### Test Plan

#### Unit Tests (Webex bot)

1. **`test_webex_websocket.py`**: WDM device registration mock, WebSocket connect/auth/recv mock, message routing (post/cardAction), reconnection on disconnect, self-message filtering.
2. **`test_ai.py`**: `stream_a2a_response_webex()` with mocked A2A client and Webex API. Verify: working message posted, progress updates sent, final message posted, feedback card sent, error handling.
3. **`test_webex_formatter.py`**: Execution plan formatting, tool notification formatting, long message splitting, error formatting.
4. **`test_cards.py`**: Feedback card schema validation, HITL form card generation from form data, user input card generation.
5. **`test_app.py`**: Message handler routing (1:1 vs group, @mention stripping), card action routing, config loading.

#### Unit Tests (Space Authorization)

6. **`test_space_auth.py`**: SpaceAuthorizationManager with mocked MongoDB — cache hit (skip DB), cache miss (query DB), TTL expiry (re-query), MongoDB unavailable (fallback to cache), `@caipe authorize` command detection, authorize card generation, denial message for unauthorized spaces.

#### Unit Tests (Webex copied modules)

7. **`test_a2a_client.py`**: Verify `X-Client-Source: webex-bot` header, SSE parsing, streaming (copied from Slack bot tests, adapted for Webex client source).
8. **`test_oauth2_client.py`**: Verify `WEBEX_INTEGRATION_AUTH_*` env var prefix works correctly.
9. **`test_event_parser.py`**: Verify event parsing works identically to Slack bot (copied tests).
10. **`test_session_manager.py`**: Verify session management with `webex_sessions` MongoDB collection.

#### Unit Tests (CAIPE UI — Authorization API)

11. **Authorization API tests**: Verify `/api/admin/integrations/webex/spaces` CRUD operations, `/api/admin/integrations/webex/authorize` OIDC session validation and space registration, admin role enforcement, error handling for invalid room IDs.

#### Integration Tests

12. **Webex bot end-to-end**: Manual test with a real Webex bot token, sending messages and verifying responses (documented as a manual test procedure).
13. **Space authorization flow**: Manual test of full authorize flow — add bot to new space, receive denial, run `@caipe authorize`, click "Connect to CAIPE", authenticate in UI, verify space is now authorized.
14. **Slack bot regression** (smoke test only): Verify existing Slack bot still works — no code changes were made, so this is a sanity check only.

### Deployment Design

#### Dockerfile (`build/Dockerfile.webex-bot`)

```dockerfile
FROM python:3.13-slim-trixie
WORKDIR /app
COPY ai_platform_engineering/integrations/webex_bot/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY ai_platform_engineering/integrations/webex_bot/ /app/
ENV PYTHONPATH=/app
CMD ["python", "-m", "app"]
```

#### docker-compose services

Production (`docker-compose.yaml`):
```yaml
webex-bot:
  image: ghcr.io/cnoe-io/caipe-webex-bot:${IMAGE_TAG:-0.2.36}
  container_name: webex-bot
  env_file: [.env]
  environment:
    - CAIPE_URL=${CAIPE_URL:-http://caipe-supervisor:8000}
    - MONGODB_URI=${MONGODB_URI:-}
  depends_on:
    - caipe-supervisor
  profiles:
    - webex-bot
    - all-integrations
```

Dev (`docker-compose.dev.yaml`):
```yaml
webex-bot:
  build:
    context: .
    dockerfile: build/Dockerfile.webex-bot
  container_name: webex-bot
  volumes:
    - ./ai_platform_engineering/integrations/webex_bot:/app
  env_file: [.env]
  environment:
    - WEBEX_BOT_TOKEN=${WEBEX_BOT_TOKEN}
    - WEBEX_INTEGRATION_ENABLE_AUTH=${WEBEX_INTEGRATION_ENABLE_AUTH:-false}
    - WEBEX_INTEGRATION_AUTH_TOKEN_URL=${WEBEX_INTEGRATION_AUTH_TOKEN_URL:-}
    - WEBEX_INTEGRATION_AUTH_CLIENT_ID=${WEBEX_INTEGRATION_AUTH_CLIENT_ID:-}
    - WEBEX_INTEGRATION_AUTH_CLIENT_SECRET=${WEBEX_INTEGRATION_AUTH_CLIENT_SECRET:-}
    - WEBEX_INTEGRATION_AUTH_SCOPE=${WEBEX_INTEGRATION_AUTH_SCOPE:-}
    - WEBEX_INTEGRATION_AUTH_AUDIENCE=${WEBEX_INTEGRATION_AUTH_AUDIENCE:-}
    - CAIPE_URL=${CAIPE_URL:-http://caipe-supervisor:8000}
    - MONGODB_URI=mongodb://admin:changeme@caipe-mongodb:27017
    - MONGODB_DATABASE=caipe
    - CAIPE_UI_BASE_URL=${CAIPE_UI_BASE_URL:-http://localhost:3000}
    - LANGFUSE_SCORING_ENABLED=${LANGFUSE_SCORING_ENABLED:-false}
    - LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY:-}
    - LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY:-}
    - LANGFUSE_HOST=${LANGFUSE_HOST:-http://langfuse-web:3000}
    - WEBEX_SPACE_AUTH_CACHE_TTL=${WEBEX_SPACE_AUTH_CACHE_TTL:-300}
  depends_on:
    - caipe-supervisor
    - caipe-mongodb
  profiles:
    - webex-bot
    - all-integrations
```

#### Environment Variables (`.env.example` additions)

```bash
# =============================================================================
# WEBEX BOT INTEGRATION (profile: webex-bot)
# =============================================================================
WEBEX_BOT_TOKEN=                          # Bot access token from developer.webex.com
WEBEX_INTEGRATION_ENABLE_AUTH=false       # Enable OAuth2 for A2A requests
WEBEX_INTEGRATION_AUTH_TOKEN_URL=         # e.g. https://your-idp.example.com/oauth2/v1/token
WEBEX_INTEGRATION_AUTH_CLIENT_ID=
WEBEX_INTEGRATION_AUTH_CLIENT_SECRET=
WEBEX_INTEGRATION_AUTH_SCOPE=             # Optional
WEBEX_INTEGRATION_AUTH_AUDIENCE=          # Optional
```

### Implementation Phases

#### Phase A: Copy Shared Modules into Webex Bot (prerequisite for Phase B)

**Rationale**: The Webex bot needs the same A2A client, event parser, session manager, OAuth2 client, MongoDB session, and Langfuse client that the Slack bot uses. Instead of extracting a shared layer (which would modify the Slack bot), we copy the modules and adapt them for Webex-specific configuration. The Slack bot is NOT modified.

| Step | Description | Files |
|------|-------------|-------|
| A1 | Create `integrations/webex_bot/` directory with `__init__.py` | new |
| A2 | Copy `a2a_client.py` from slack_bot, change `X-Client-Source` to `"webex-bot"` | new (copied + adapted) |
| A3 | Copy `event_parser.py` from slack_bot (no changes needed — platform-agnostic) | new (copied) |
| A4 | Copy `oauth2_client.py` from slack_bot, change default prefix to `WEBEX_INTEGRATION_AUTH` | new (copied + adapted) |
| A5 | Copy `session_manager.py` from slack_bot (no changes needed — platform-agnostic) | new (copied) |
| A6 | Copy `mongodb_session.py` from slack_bot, change collection to `webex_sessions` | new (copied + adapted) |
| A7 | Copy `langfuse_client.py` from slack_bot (no changes needed — platform-agnostic) | new (copied) |
| A8 | Write unit tests for copied modules (verify Webex-specific adaptations) | new |

#### Phase B: Webex Bot Core (Stories 1, 2 — P1)

| Step | Description | Files |
|------|-------------|-------|
| B1 | Create `webex_bot/` directory structure | new |
| B2 | Implement `webex_websocket.py` (WDM + WebSocket, based on jarvis-agent) | new |
| B3 | Implement `utils/config.py` and `utils/config_models.py` | new |
| B4 | Implement `app.py` entry point (startup, handler wiring) | new |
| B5 | Implement `utils/webex_formatter.py` (markdown formatting) | new |
| B6 | Implement `utils/ai.py` (stream_a2a_response_webex with hybrid approach) | new |
| B7 | Implement `utils/webex_context.py` (message text extraction, @mention stripping) | new |
| B8 | Implement `utils/cards.py` (feedback + authorize cards) | new |
| B9 | Create `requirements.txt` | new |
| B10 | Write unit tests for all new modules | new |

#### Phase B2: Space Authorization (Story 2b — P1)

| Step | Description | Files |
|------|-------------|-------|
| B2-1 | Implement `utils/space_auth.py` (SpaceAuthorizationManager with MongoDB + TTL cache) | new |
| B2-2 | Add `@caipe authorize` command detection and routing in `app.py` | modify |
| B2-3 | Add `create_authorize_card()` to `utils/cards.py` (Adaptive Card with "Connect to CAIPE" button) | modify |
| B2-4 | Wire authorization check into message handler (deny unauthorized spaces) | modify |
| B2-5 | Write unit tests for space auth (cache hit/miss, expired TTL, MongoDB fallback) | new |

#### Phase B3: CAIPE UI — Authorization API & Admin (Stories 2b, 2b-admin — P1/P2)

| Step | Description | Files |
|------|-------------|-------|
| B3-1 | Add `AuthorizedWebexSpace` type to `ui/src/types/mongodb.ts` | modify |
| B3-2 | Add `authorized_webex_spaces` collection + indexes to `ui/src/lib/mongodb.ts` | modify |
| B3-3 | Create `api/admin/integrations/webex/authorize/route.ts` (OIDC-gated space authorization) | new |
| B3-4 | Create `api/admin/integrations/webex/spaces/route.ts` (GET list, POST add) | new |
| B3-5 | Create `api/admin/integrations/webex/spaces/[id]/route.ts` (DELETE revoke) | new |
| B3-6 | Add "Integrations" tab to admin dashboard with authorized spaces table | modify |
| B3-7 | Write API tests for authorization endpoints | new |

#### Phase C: Threading & HITL (Stories 4, 5 — P2/P3)

| Step | Description | Files |
|------|-------------|-------|
| C1 | Add parentId-based threading to message handler and `stream_a2a_response_webex` | modify |
| C2 | Implement `utils/hitl_handler.py` (Adaptive Card HITL forms) | new |
| C3 | Wire card action handler in `app.py` | modify |
| C4 | Write HITL and threading tests | new |

#### Phase D: Deployment (Story 1 FR-011)

| Step | Description | Files |
|------|-------------|-------|
| D1 | Create `build/Dockerfile.webex-bot` | new |
| D2 | Add webex-bot service to `docker-compose.yaml` and `docker-compose.dev.yaml` | modify |
| D3 | Create Helm subchart `charts/.../charts/webex-bot/` | new |
| D4 | Update parent Helm chart (`Chart.yaml`, `values.yaml`) | modify |
| D5 | Create `deploy/secrets-examples/webex-secret.yaml.example` | new |
| D6 | Update `.env.example` with Webex variables | modify |
| D7 | Update CI workflow paths for webex-bot Docker build trigger | modify |
| D8 | Update `Makefile` with webex-bot test targets | modify |

#### Phase E: Documentation

| Step | Description | Files |
|------|-------------|-------|
| E1 | Create `docs/docs/integrations/webex-bot.md` (user-facing integration docs) | new |
| E2 | Create ADR in `docs/docs/changes/` for Webex bot architecture and deferred commonization decision | new |
| E3 | Update `docs/docs/specs/098-webex-bot-integration/spec.md` status to Implemented | modify |

### Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Webex WebSocket API changes or WDM deprecation | Low | High | Pin `webexteamssdk` version; abstract WDM behind interface; monitor Webex changelog |
| Webex message rate limiting on updates | Medium | Medium | Throttle updates to 3s minimum interval; batch content; fall back to single final message |
| Code duplication between Slack and Webex bots | N/A | Low | Accepted trade-off: duplication is preferable to modifying the stable Slack bot. Commonization deferred to future spec |
| `webexteamssdk` vs `webexpythonsdk` migration | Low | Low | Start with `webexteamssdk` (same as jarvis-agent); migrate to `webexpythonsdk` later if needed |
| Pickle-based device caching (security) | N/A | N/A | Eliminated — use in-memory caching only (no `pickle` deserialization of untrusted data) |
| MongoDB unavailable during space auth check | Low | Medium | In-memory TTL cache serves as fallback; cold start with no MongoDB denies messages and logs error |
| Space auth cache stale after revocation | Low | Low | 5-minute TTL ensures revocations take effect within the window; admin can force cache invalidation via webhook (future) |
| UI authorization endpoint abuse | Low | Medium | OIDC authentication required; OIDC group membership validated; rate limiting on authorization endpoint |
