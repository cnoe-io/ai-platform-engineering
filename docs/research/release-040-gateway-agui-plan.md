# Release 0.4.0 — Gateway + AG-UI Implementation Plan

**North star**: [Architecture Overview](https://gist.github.com/subbaksh/72b9565e012cacda0510f5433d4e15ee)
**Branch**: `prebuild/refactor/stream-encoder-abstraction-v2` (off `release/0.4.0`)

## Target State

All three client paths use **AG-UI as the wire protocol** through the **Next.js gateway**:

```
UI Chat ──────────┐
                  │   REST + SSE
Slack Bot (pod) ──┼──────────────────► Next.js Gateway ────► Agent Runtime
                  │                   (auth, audit,          (stateless,
Webex/CLI ────────┘                    turns persistence)     LangGraph)
(future)
```

Key constraints:
- **Dynamic agents UI must support BOTH custom SSE and AG-UI** (via adapter layer, selected by `AGENT_PROTOCOL` env var). This forces protocol-agnostic architecture.
- **Supervisor streaming moves to the gateway** (same API surface as dynamic agents).
- **Slack bot switches from talking directly to supervisor to going through the gateway.**
- **New `turns` collection** for client-specific per-turn persistence (UI stores stream events, Slack stores thread mapping).
- **No backward compat needed** for existing conversation data — stakeholders approved clean slate.

---

## Phase 0: Commit Existing Work

Land all uncommitted UI changes as a clean baseline.

**Already done (uncommitted):**
- `Stream*` rename (17+ files)
- `MarkdownRenderer` (marked + morphdom + remend)
- `saveMessagesToServer` restored with `collapseStreamEvents`
- `AGENT_PROTOCOL` env var + proxy wiring
- DRY stream loops, bug fixes, dead code removal

**Tasks:**
1. `npx tsc --noEmit` — verify clean
2. `npx next build` — verify clean
3. Commit with `--signoff`, grouped by concern
4. Push to branch

**No new features — just land what's built.**

---

## Phase 1: Streaming Adapter Layer

Protocol-agnostic abstraction for consuming SSE streams. Mirror of the backend `StreamEncoder` ABC.

### New files

**`ui/src/lib/streaming/parse-sse.ts`**
- Extract `parseSSEStream` from `DynamicAgentClient` into a standalone async generator
- Safari-compatible (`ReadableStreamDefaultReader` + `TextDecoder`)
- Yields `{ event: string; data: string }` objects
- Both adapters use this

**`ui/src/lib/streaming/callbacks.ts`**
- `StreamCallbacks` interface — semantic methods:
  - `onContent(text, namespace)`, `onToolStart(toolCallId, toolName, args?, namespace?)`
  - `onToolEnd(toolCallId, toolName?, error?, namespace?)`, `onInputRequired(interruptId, prompt, fields, agent)`
  - `onWarning(message, namespace?)`, `onDone()`, `onError(message)`
  - `onRawEvent(event)` — raw wire event for storage/replay
- `RawStreamEvent` type — `{ type: string; data: unknown; timestamp: number }`
- `StreamParams` — `{ message?, conversationId, agentId, formData? }`
- All callbacks optional (adapters check before calling)

**`ui/src/lib/streaming/adapter.ts`**
- `StreamAdapter` interface:
  - `streamMessage(params, callbacks): Promise<void>`
  - `resumeStream(params, callbacks): Promise<void>`
  - `cancelStream(conversationId, agentId?): Promise<boolean>`
  - `abort(): void`
- `createStreamAdapter({ protocol, baseUrl, accessToken })` factory

**`ui/src/lib/streaming/custom-adapter.ts`**
- Refactored from `DynamicAgentClient.sendMessageStream` + `mapToStreamEvent`
- Maps: `content` → `onContent`, `tool_start` → `onToolStart`, `tool_end` → `onToolEnd`, etc.
- Every wire event fires `onRawEvent` for persistence

**`ui/src/lib/streaming/agui-adapter.ts`**
- Owns AG-UI state: `currentNamespace`, `toolCallIdToName`, `runId`
- Maps:
  - `TEXT_MESSAGE_CONTENT` → `onContent(delta, namespace)`
  - `TOOL_CALL_START` → `onToolStart(toolCallId, toolCallName, undefined, namespace)`
  - `TOOL_CALL_END` → `onToolEnd(toolCallId, resolvedToolName, undefined, namespace)`
  - `CUSTOM(TOOL_ERROR)` → `onToolEnd(toolCallId, undefined, error, namespace)`
  - `CUSTOM(WARNING)` → `onWarning(message, namespace)`
  - `RUN_FINISHED outcome:"success"` → `onDone()`
  - `RUN_FINISHED outcome:"interrupt"` → `onInputRequired(id, prompt, fields, agent)`
  - `RUN_ERROR` → `onError(message)`
  - `RUN_STARTED`, `TEXT_MESSAGE_START/END`, `CUSTOM(NAMESPACE_CONTEXT)` → internal state only
- Every wire event fires `onRawEvent`

**`ui/src/lib/streaming/index.ts`**
- Barrel export: `createStreamAdapter`, `StreamAdapter`, `StreamCallbacks`, `StreamParams`, `RawStreamEvent`

### Design principle

Both adapters produce the **exact same callback sequence** for equivalent agent behavior. A test could verify: given the same agent turn, `custom-adapter` and `agui-adapter` fire the same callbacks in the same order (modulo timing).

---

## Phase 2: Wire Adapter into DynamicAgentChatPanel

Replace `DynamicAgentClient` + `for await` loop with adapter calls.

### Changes to `DynamicAgentChatPanel.tsx`
- `processStreamEvent` logic moves into `StreamCallbacks` implementations
- `finalizeStreamLoop` called from `onDone` / `onError` callbacks
- Same for `handleUserInputSubmitSSE` → `adapter.resumeStream()`
- `cancelConversationRequest` → `adapter.cancelStream()`
- `agentProtocol` passed as prop from server component (no API round-trip)

### What stays
- `MarkdownRenderer`, timeline, HITL form — all protocol-agnostic, no changes
- `StreamEvent` / `createStreamEvent` in `sse-types.ts` — still used to build store events from callbacks
- `addStreamEvent`, `clearStreamEvents` in store — unchanged

### What gets deprecated
- `DynamicAgentClient.sendMessageStream` / `resumeStream` — replaced by adapter
- `DynamicAgentClient.mapToStreamEvent` — mapping logic now lives in adapters
- `DynamicAgentClient.parseSSEStream` — extracted to `parse-sse.ts`
- `DynamicAgentClient` class kept temporarily for `cancelStream` (backend cancel POST), can be inlined later

---

## Phase 3: Unified Gateway Streaming Routes

Consolidate all streaming behind consistent routes. Both dynamic agents and supervisor use the same URL pattern.

### New/migrated routes

```
POST /api/conversations/:id/stream/start    → proxy to agent runtime (dynamic agents or supervisor)
POST /api/conversations/:id/stream/resume   → proxy to agent runtime
POST /api/conversations/:id/stream/cancel   → proxy to agent runtime
```

### Routing logic

The gateway determines which backend to proxy to based on the conversation's `agent_id`:
- `agent_id` present → dynamic agents runtime (`DYNAMIC_AGENTS_URL`)
- `agent_id` absent → supervisor (`SUPERVISOR_SSE_URL`)

The route appends `?protocol=` based on `AGENT_PROTOCOL` env var (for dynamic agents). Supervisor always uses AG-UI natively.

### Request body transformation

The gateway accepts a **unified request body** and transforms it to the target backend's expected format:

```typescript
// Unified input (what the client sends)
{
  message: string;
  conversationId: string;        // doubles as threadId
  agentId?: string;              // if present → dynamic agents
  turnId?: string;               // doubles as runId for supervisor
  formData?: string;             // for resume
  source?: string;               // "ui" | "slack" | "webex"
  forwardedProps?: Record<string, unknown>;
}
```

For **dynamic agents**, transformed to:
```json
{ "message": "...", "conversation_id": "...", "agent_id": "..." }
```

For **supervisor** (temporary — supervisor backend will be deprecated in a future release), transformed to AG-UI `RunAgentInput`:
```json
{
  "threadId": "...", "runId": "...",
  "messages": [{"id": "...", "role": "user", "content": "..."}],
  "state": {}, "tools": [], "context": [],
  "forwardedProps": { "source": "slack", ... }
}
```

> **Note**: Once the supervisor is removed, this transformation goes away. The unified format becomes the only format, and the gateway talks exclusively to the dynamic agents runtime.

### Old routes
- `/api/dynamic-agents/chat/start-stream` → deprecated, redirect or remove
- `/api/dynamic-agents/chat/resume-stream` → deprecated, redirect or remove
- `/api/chat/stream` (supervisor) → deprecated, kept as alias during transition

### SSE pass-through
- Same pattern as today: `new Response(backendResponse.body, { headers: SSE_HEADERS })`
- No server-side tap for now — client persists turns after stream ends

---

## Phase 4: Route Supervisor Through Gateway

Make `ChatPanel` (supervisor UI) use the same adapter layer and unified routes.

### Approach: Refactor ChatPanel to use StreamAdapter
- ChatPanel switches from `streamAGUIEvents()` (which uses `@ag-ui/client` HttpAgent) to `createStreamAdapter({ protocol: "agui", baseUrl })`
- The adapter talks to the new unified `/api/conversations/:id/stream/start` route
- `sendMessage` in `chat-store.ts` is refactored to use the adapter instead of `streamAGUIEvents`
- Both `ChatPanel` and `DynamicAgentChatPanel` use the same adapter layer

### Impact
- `@ag-ui/client` dependency can be removed from `package.json` (agui-adapter replaces it)
- `streamAGUIEvents` in `ui/src/lib/agui/hooks.ts` becomes dead code
- Supervisor path now benefits from `onRawEvent` for turns persistence

### Supervisor HITL alignment (lower priority)
- Supervisor currently uses `CUSTOM("INPUT_REQUIRED")` event
- Target: move to `RUN_FINISHED + outcome:"interrupt"` to align with AG-UI draft spec and dynamic agents
- Requires change in supervisor backend (`stream_handler.py`)
- AG-UI adapter should handle both formats during transition (check `CUSTOM("INPUT_REQUIRED")` as fallback)

---

## Phase 5: Turns Collection

Client-specific per-turn persistence, decoupled from message documents.

### MongoDB collection: `turns`

```javascript
{
  _id: ObjectId,
  conversation_id: string,      // = LangGraph thread_id
  client_type: string,           // "ui" | "slack" | "webex" | ...
  turn_index: number,            // sequential within (conversation_id, client_type)
  turn_id: string,               // matches turnId from streaming
  payload: object,               // opaque, client-specific
  created_at: Date,
  updated_at: Date,
}
```

**Indexes:**
- `{ conversation_id: 1, client_type: 1, turn_index: 1 }` — unique
- `{ conversation_id: 1, client_type: 1 }` — for fetching all turns

### API route: `/api/conversations/:id/turns`

```
GET  /api/conversations/:id/turns?client_type=ui     → fetch turns for a conversation
POST /api/conversations/:id/turns                     → upsert a turn document
```

Gateway does **not** validate or interpret the payload — it's opaque.

### UI turn payload (what the browser stores per turn)

```typescript
{
  stream_events: StreamEvent[];    // collapsed (not per-token, ~95% reduction)
  turn_id: string;
  assistant_msg_id: string;
  user_msg_id: string;
  turn_status: "done" | "interrupted" | "waiting_for_input";
}
```

### Slack turn payload (what the Slack bot stores per turn)

```typescript
{
  slack_thread_ts: string;
  slack_channel: string;
  slack_team_id?: string;
}
```

### Persistence changes
- `saveMessagesToServer` → writes turn to `/api/conversations/:id/turns` with `client_type: "ui"` instead of embedding `stream_events` in the message
- `loadMessagesFromServer` → fetches turns from `/api/conversations/:id/turns?client_type=ui`, matches by `turn_id`, attaches `streamEvents` to messages for timeline rendering
- No backward compat for old embedded `stream_events` — clean slate approved
- Migration script can be written later if edge cases surface

---

## Phase 6: Slack Bot Switches to Gateway

The Slack bot stops talking directly to the supervisor and uses the gateway instead.

### Current flow
```
Slack Bot → POST {SUPERVISOR_SSE_URL}/chat/stream → Supervisor SSE Server
Slack Bot → GET  {SUPERVISOR_SSE_URL}/api/v1/conversations/lookup → Supervisor REST
```

### Target flow
```
Slack Bot → POST {GATEWAY_URL}/api/conversations/:id/stream/start → Gateway → Runtime
Slack Bot → GET  {GATEWAY_URL}/api/conversations/:id → Gateway
Slack Bot → POST {GATEWAY_URL}/api/conversations/:id/turns → Gateway (persist turn)
```

### Changes to Slack bot

**`sse_client.py`:**
- Change base URL from `SUPERVISOR_SSE_URL` to `GATEWAY_URL` (Next.js)
- Change endpoint from `/chat/stream` to `/api/conversations/:id/stream/start`
- Request body: adapt to unified gateway format
- SSE response format unchanged (still AG-UI events piped through)

**`session_manager.py`:**
- Change lookup endpoint from supervisor's `/api/v1/conversations/lookup` to gateway equivalent
- New gateway route: `GET /api/conversations/lookup?client_type=slack&thread_ts=...`
- Queries `turns` collection for `{ client_type: "slack", "payload.slack_thread_ts": thread_ts }`

**`utils/ai.py` (`stream_sse_response`):**
- On stream finalize, POST turn to `/api/conversations/:id/turns` with `client_type: "slack"` and payload `{ slack_thread_ts, slack_channel }`

**Auth:**
- Keep current OIDC auth mechanism (`auth_client`) — just retarget to gateway URL
- Gateway routes already accept OIDC tokens

---

## Phase 7: Verification Matrix

Every combination must work:

| Client | Protocol | Backend | Stream | HITL | Cancel | Turns |
|--------|----------|---------|--------|------|--------|-------|
| UI → Dynamic Agent | custom SSE | DA runtime | ✓ | ✓ | ✓ | ✓ |
| UI → Dynamic Agent | AG-UI | DA runtime | ✓ | ✓ | ✓ | ✓ |
| UI → Supervisor | AG-UI | Supervisor | ✓ | ✓ | ✓ | ✓ |
| Slack → Supervisor | AG-UI (via gw) | Supervisor | ✓ | ✓ | — | ✓ |
| Slack → Dynamic Agent | AG-UI (via gw) | DA runtime | ✓ | ✓ | — | ✓ |

### Validation commands
- `npx tsc --noEmit` — TypeScript clean
- `npx next build` — build clean
- `uv run ruff check` — Python lint (Slack bot changes)
- Manual test matrix above

---

## Dependency Graph

```
Phase 0 (commit baseline)
    │
    ▼
Phase 1 (adapter layer) ──────────────────────────┐
    │                                               │
    ▼                                               │
Phase 2 (wire into DynamicAgentChatPanel)          │
    │                                               │
    ├──► Phase 3 (unified gateway routes) ◄────────┘
    │         │
    │         ├──► Phase 4 (supervisor through gateway)
    │         │
    │         ├──► Phase 5 (turns collection)
    │         │         │
    │         └─────────┼──► Phase 6 (Slack bot migration)
    │                   │
    └───────────────────┼──► Phase 7 (verify all)
                        │
                        ▼
```

Phases 1-2 are prerequisites for everything else.
Phase 3 unblocks 4, 5, and 6.
Phases 4, 5, 6 can be done in parallel once Phase 3 is complete.
Phase 7 is final validation.

---

## Notes

- **Supervisor HITL alignment** (move to `RUN_FINISHED + interrupt`): lower priority, get basic implementation working. AG-UI adapter handles both `CUSTOM("INPUT_REQUIRED")` and `RUN_FINISHED+interrupt` during transition.
- **Slack auth**: keep current OIDC mechanism, just retarget URL.
- **No backward compat** for old `stream_events` embedded in messages — clean slate approved by stakeholders.
