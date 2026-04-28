# Message Flow Architecture

**Date:** 2026-04-13
**Branch:** `prebuild/refactor/stream-encoder-abstraction-v2` (release/0.4.0)

This document traces the complete code path for sending a message through each of the three entry points: UI to Supervisor, UI to Dynamic Agent, and Slack to Supervisor.

---

## 1. UI → Supervisor (Platform Engineer)

### Flow Diagram

```
User types message
    │
    ▼
ChatContainer.tsx:402
    Condition: !selectedAgentId || !dynamicAgentsEnabled
    Renders: <SupervisorChatView>
    │
    ▼
SupervisorChatView.tsx:46
    Thin wrapper, renders <SupervisorChatPanel>
    │
    ▼
SupervisorChatPanel.tsx:360 — submitMessage()
    ├─ createConversation() via chat-store (if new)
    ├─ addMessage() user + assistant placeholder via chat-store
    ├─ Creates A2ASDKClient({ endpoint })                    [line 415]
    ├─ Calls a2aClient.sendMessageStream(msg, convId)        [line 421]
    └─ for await (event of stream) → builds timeline, updates store
    │
    ▼
a2a-sdk-client.ts:212 — sendMessageStream()
    Wraps @a2a-js/sdk JsonRpcTransport
    │
    ▼  DIRECT browser → backend (no Next.js proxy)
    │
    POST http://localhost:8000/chat/stream
    Content-Type: application/json
    Accept: text/event-stream
    Body: { jsonrpc: "2.0", method: "message/stream", params: { message: {...} } }
    │
    ▼
Backend: main.py:142 — A2AStarletteApplication
    Dispatches JSON-RPC "message/stream" →
    agent_executor.py — AIPlatformEngineerA2AExecutor
    → LangGraph multi-agent supervisor
    → Streams SSE: TaskStatusUpdate, TaskArtifactUpdate
```

### Step-by-Step

#### 1. ChatContainer — Routing Decision

**File:** `ui/src/components/chat/ChatContainer.tsx:402`

```tsx
return selectedAgentId && dynamicAgentsEnabled ? (
    <ChatView ... />
) : (
    <SupervisorChatView ... />
);
```

- `selectedAgentId` is derived via `getAgentId(conv)` from the conversation's `participants` array.
- `dynamicAgentsEnabled` is read from config via `getConfig('dynamicAgentsEnabled')`.
- A new conversation with no agent participant always goes to `SupervisorChatView`.

The `chatEndpoint` prop is computed as `${caipeUrl}/chat/stream` (e.g., `http://localhost:8000/chat/stream`).

#### 2. SupervisorChatView — Thin Wrapper

**File:** `ui/src/components/chat/SupervisorChatView.tsx:26`

Minimal wrapper that checks backend health via `useCAIPEHealth()` and renders `<SupervisorChatPanel>` with all props passed through.

#### 3. SupervisorChatPanel — Message Submission

**File:** `ui/src/components/chat/SupervisorChatPanel.tsx:360` — `submitMessage()`

1. Gets or creates conversation ID via `createConversation()` from chat-store
2. Clears previous turn events: `clearA2AEvents(convId)`
3. Adds user message + assistant placeholder to store via `addMessage()`
4. Creates `A2ASDKClient({ endpoint, accessToken, userEmail })` (line 415)
5. Calls `a2aClient.sendMessageStream(messageToSend, convId)` (line 421) — returns an async generator
6. Iterates: `for await (const event of eventStream)` (line 468) — parses events, builds `SupervisorTimelineSegment[]` via `SupervisorTimelineManager`, accumulates content, handles HITL forms
7. Finalizes: sets `isFinal`, persists timeline segments and raw stream content
8. Calls `setConversationStreaming(null)` which triggers `saveMessagesToServer()` → MongoDB

#### 4. chat-store — State Management

**File:** `ui/src/store/chat-store.ts`

The store does **not** call the backend A2A endpoint. It manages local state and MongoDB persistence. Key actions used during the flow:

| Action | Purpose |
|--------|---------|
| `createConversation(agentId?)` | Creates conversation locally + in MongoDB |
| `addMessage(convId, msg, turnId)` | Adds user/assistant messages to local state |
| `updateMessage(convId, msgId, updates)` | Updates message content during streaming |
| `addA2AEvent(event, convId)` | Adds A2A events to conversation's event list |
| `setConversationStreaming(convId, state)` | Tracks streaming state; `null` triggers save to MongoDB |
| `saveMessagesToServer(convId)` | Persists messages via `apiClient.addMessage()` |

#### 5. A2ASDKClient — Protocol & Endpoint

**File:** `ui/src/lib/a2a-sdk-client.ts:212` — `sendMessageStream()`

- Wraps `@a2a-js/sdk`'s `JsonRpcTransport`
- Protocol: **A2A JSON-RPC 2.0** over HTTP with SSE streaming
- Sends: `POST {endpoint}` with `{ jsonrpc: "2.0", method: "message/stream", params: { message: {...} } }`
- Request headers: `Content-Type: application/json`, `Accept: text/event-stream`, `Authorization: Bearer {token}`
- Safari fallback (line 311): bypasses `TextDecoderStream` and parses SSE manually

#### 6. Backend — A2A Server

**File:** `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/main.py:142`

- Built with `A2AStarletteApplication` from the `a2a` Python library
- Receives JSON-RPC POST, dispatches `message/stream` method
- Delegates to `AIPlatformEngineerA2AExecutor` (`agent_executor.py`)
- Executes via LangGraph multi-agent supervisor (Platform Engineer)
- Streams back `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` as SSE
- CORS enabled for all origins (browser calls backend directly)

### Key Characteristics

- **Protocol:** A2A JSON-RPC 2.0 over SSE
- **Proxy:** None — browser calls backend directly
- **Timeline:** Built by `SupervisorTimelineManager` inside the panel's streaming loop
- **State:** Managed by Zustand `chat-store`; saved to MongoDB after stream ends

---

## 2. UI → Dynamic Agent

### Flow Diagram

```
User types message
    │
    ▼
ChatContainer.tsx:402
    Condition: selectedAgentId && dynamicAgentsEnabled
    Renders: <ChatView>
    │
    ▼
ChatView.tsx:74
    Renders: <ChatPanel> + <DynamicAgentContext>
    │
    ▼
ChatPanel.tsx:780 — submitMessage()
    ├─ createConversation(agentId) via chat-store
    ├─ addMessage() user + assistant placeholder
    ├─ createStreamAdapter({ protocol, accessToken })        [line 806]
    │   → Returns CustomStreamAdapter or AGUIStreamAdapter
    ├─ buildStreamCallbacks() → onContent, onToolStart, etc. [line 828]
    └─ adapter.streamMessage(params, callbacks)               [line 830]
    │
    ▼
CustomStreamAdapter.streamMessage() (custom-adapter.ts:72)
    │
    POST /api/chat/conversations/{id}/stream/start    ← Next.js API route
    Accept: text/event-stream
    │
    ▼
Next.js route: stream/start/route.ts:23
    ├─ Authenticates request (JWT from session)
    ├─ Gets dynamicAgentsUrl from server config
    └─ proxySSEStream() → transparent byte-level pipe
    │
    ▼
    POST {DYNAMIC_AGENTS_URL}/api/v1/chat/stream/start?protocol=custom
    │
    ▼
Backend: chat.py:82 — chat_start_stream()
    ├─ Loads agent config from MongoDB
    ├─ Gets encoder via get_encoder(protocol)
    │   → CustomStreamEncoder or AGUIStreamEncoder
    ├─ Gets/creates agent runtime from cache
    └─ runtime.stream(message, ..., encoder)
        → LangGraph agent execution
        → Encoder formats SSE frames
    │
    ▼  SSE frames piped back:
    backend → Next.js proxy → browser → parseSSEStream()
    → adapter._dispatchEvent() → callbacks → store → React
```

### Step-by-Step

#### 1. ChatContainer — Routing Decision

**File:** `ui/src/components/chat/ChatContainer.tsx:402`

Same condition as supervisor but inverted: if `selectedAgentId && dynamicAgentsEnabled`, renders `<ChatView>`.

The `chatEndpoint` prop is computed as `${dynamicAgentsUrl}/agents/${selectedAgentId}/chat`.

#### 2. ChatView — Layout Wrapper

**File:** `ui/src/components/chat/ChatView.tsx:49`

Renders two children:
1. `<ChatPanel>` — the main chat interface (props: `endpoint`, `conversationId`, `agentId`, `agentGradient`, `agentName`, etc.)
2. `<DynamicAgentContext>` — collapsible side panel showing agent info, tools, and subagents (starts collapsed)

#### 3. ChatPanel — Message Submission

**File:** `ui/src/components/chat/ChatPanel.tsx:780` — `submitMessage()`

1. Creates conversation if needed: `createConversation(agentId)` (line 786)
2. Clears previous turn's stream events: `clearStreamEvents(convId)` (line 790)
3. Adds user message + assistant placeholder with `turnId` (lines 793-803)
4. Creates streaming adapter (line 806):
   ```tsx
   const adapter = createStreamAdapter({
     protocol: agentProtocol as "custom" | "agui",
     accessToken,
   });
   ```
5. Builds callbacks via `buildStreamCallbacks()` (line 828) — returns `StreamCallbacks`:
   - `onContent(text, ns)` — accumulates text, creates stream event, calls `updateMessage()`
   - `onToolStart(id, name, args, ns)` — records tool name mapping, emits stream event
   - `onToolEnd(id, name?, error?, ns)` — emits stream event, triggers file/todo re-fetches
   - `onInputRequired(id, prompt, fields, agent)` — shows HITL form
   - `onWarning(message, ns)` — emits stream event
   - `onError(message)` — sets error state
6. Calls `adapter.streamMessage(params, callbacks)` (line 830)
7. Finalizes: `finalizeStreamLoop()` (line 836)

#### 4. Streaming Adapter Layer

**File:** `ui/src/lib/streaming/adapter.ts:59` — `createStreamAdapter()`

Factory that returns either `CustomStreamAdapter` or `AGUIStreamAdapter` based on `config.protocol`.

##### CustomStreamAdapter (protocol = "custom")

**File:** `ui/src/lib/streaming/custom-adapter.ts:72`

- POSTs to `/api/chat/conversations/{id}/stream/start` (Next.js API route)
- Headers: `Content-Type: application/json`, `Accept: text/event-stream`, `Authorization: Bearer {token}`
- Body: `{ message, agent_id }`
- Parses response via `parseSSEStream()` (`parse-sse.ts:32`) — async generator using `getReader()` + `TextDecoder`, splits on `\n\n`
- Dispatches events to callbacks based on SSE event type:

| SSE Event | Callback | Terminal? |
|-----------|----------|-----------|
| `content` | `onContent(text, namespace)` | No |
| `tool_start` | `onToolStart(id, name, args, ns)` | No |
| `tool_end` | `onToolEnd(id, name?, error?, ns)` | No |
| `input_required` | `onInputRequired(id, prompt, fields, agent)` | Yes |
| `warning` | `onWarning(message, ns)` | No |
| `done` | `onDone()` | Yes |
| `error` | `onError(message)` | Yes |

##### AGUIStreamAdapter (protocol = "agui")

**File:** `ui/src/lib/streaming/agui-adapter.ts`

Same URL pattern, same `_stream` mechanism, but dispatches AG-UI event types: `RUN_STARTED`, `TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START`, `TOOL_CALL_END`, `RUN_FINISHED`, `RUN_ERROR`, `CUSTOM`.

#### 5. Next.js API Route (Proxy)

**File:** `ui/src/app/api/chat/conversations/[id]/stream/start/route.ts:23`

**Helpers:** `ui/src/app/api/chat/conversations/[id]/stream/_helpers.ts`

1. Authenticates via `authenticateRequest(request)` — extracts JWT access token from session
2. Validates config via `getDynamicAgentsConfig()` — checks feature flag, gets backend URL
3. Constructs backend URL: `${dynamicAgentsUrl}/api/v1/chat/stream/start?protocol=${agentProtocol}`
4. Calls `proxySSEStream()` (`_helpers.ts:104`) — **transparent byte-level pipe**: POSTs to backend, pipes `response.body` directly back to browser as `new Response(backendResponse.body, { headers: SSE_RESPONSE_HEADERS })`

#### 6. Backend Endpoint

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py:82` — `chat_start_stream()`

1. Gets agent config from MongoDB: `mongo.get_agent(request.agent_id)`
2. Checks access: `can_use_agent(agent, user)`
3. Gets MCP server configs for the agent's tools
4. Gets encoder: `get_encoder(protocol)` — `CustomStreamEncoder` or `AGUIStreamEncoder`
5. Returns `StreamingResponse` wrapping `_generate_sse_events()`:
   - Gets/creates agent runtime from cache
   - Calls `runtime.stream(message, session_id, user.email, trace_id, encoder)`
   - Encoder formats LangGraph events into protocol-specific SSE frames

### Wire Formats

**Custom protocol:**
```
event: content
data: {"text": "Hello ", "namespace": ["agent-name"]}

event: tool_start
data: {"tool_call_id": "tc_123", "tool_name": "search", "args": {...}, "namespace": [...]}

event: tool_end
data: {"tool_call_id": "tc_123", "namespace": [...]}

event: done
data: {}
```

**AG-UI protocol:**
```
event: RUN_STARTED
data: {"runId": "run_abc"}

event: TEXT_MESSAGE_CONTENT
data: {"delta": "Hello "}

event: TOOL_CALL_START
data: {"toolCallId": "tc_123", "toolCallName": "search"}

event: TOOL_CALL_END
data: {"toolCallId": "tc_123"}

event: RUN_FINISHED
data: {"outcome": "success"}
```

### Key Characteristics

- **Protocol:** Custom SSE or AG-UI (config-driven via `agentProtocol`)
- **Proxy:** Next.js API route (auth + config resolution, transparent SSE pipe)
- **Adapter pattern:** `StreamAdapter` + `StreamCallbacks` — protocol-agnostic interface
- **Encoder pattern:** `StreamEncoder` ABC on backend — protocol-agnostic agent runtime
- **Timeline:** Built by `TimelineManager` via `useAgentTimeline` hook (not in streaming loop)

---

## 3. Slack → Supervisor

### Flow Diagram

```
User sends @CAIPE message or DM in Slack
    │
    ▼
app.py:99 — handle_mention() / app.py:433 — handle_message_events()
    ├─ extract_message_text(event)
    ├─ get_message_author_info()
    ├─ build_thread_context() (if in-thread)
    ├─ session_manager.get_context_id(thread_ts)
    │   → GET {SUPERVISOR_URL}/api/v1/conversations/lookup?source=slack&thread_ts=...
    └─ Calls ai.stream_a2a_response(a2a_client, ...)
    │
    ▼
ai.py:118 — stream_a2a_response()
    ├─ slack_client.chat_startStream()  → opens Slack streaming slot
    ├─ a2a_client.send_message_stream(message, context_id, metadata)
    │
    ▼
a2a_client.py:153 — A2AClient.send_message_stream()
    │
    POST {CAIPE_URL}/
    Content-Type: application/json
    Accept: text/event-stream
    Body: { jsonrpc: "2.0", method: "message/stream", params: { message: {...} } }
    │
    ▼
Backend: main.py:142 — same A2A server as UI supervisor path
    │
    ▼  SSE events streamed back
    │
ai.py:279 — parse_event(event_data)    ← event_parser.py:86
    │
    ├─ streaming_result → StreamBuffer.append() → chat_appendStream
    ├─ tool_notification_start/end → tool progress cards
    ├─ execution_plan → plan step cards
    ├─ caipe_form → HITL interactive forms
    ├─ final_result → authoritative answer
    └─ status-update → completed/failed
    │
    ▼
slack_client.chat_stopStream()  → finalizes Slack message + feedback buttons
```

### Step-by-Step

#### 1. Slack Event Router

**File:** `ai_platform_engineering/integrations/slack_bot/app.py`

Two primary entry points:

| Handler | Decorator | Line | Trigger |
|---------|-----------|------|---------|
| `handle_mention()` | `@app.event("app_mention")` | 99 | `@CAIPE` mentions |
| `handle_message_events()` | `@app.event("message")` | 433 | DMs, Q&A auto-responses, bot alerts |

`handle_message_events` routes to:
- `handle_dm_message()` (line 320) for `channel_type == "im"`
- `handle_qanda_message()` (line 240) for non-bot, non-thread messages with Q&A enabled
- `ai.handle_ai_alert_processing()` (line 507) for bot messages with AI alerts enabled

#### 2. Message Preparation (example: @mention)

**File:** `ai_platform_engineering/integrations/slack_bot/app.py:100-190`

1. Extracts message text via `slack_context.extract_message_text(event)` — parses text from event body, blocks, and attachments
2. Gets user info via `utils.get_message_author_info(event, client)`
3. Builds thread context (if in-thread) via `slack_context.build_thread_context()` — fetches thread history and formats as conversation context
4. Gets/creates conversation ID via `session_manager.get_context_id(thread_ts)` — checks local TTL cache, then calls `GET {SUPERVISOR_URL}/api/v1/conversations/lookup?source=slack&thread_ts=...`
5. Formats prompt with Slack-specific metadata (`source: slack`, channel, thread, user, interaction type)

#### 3. Streaming Orchestrator

**File:** `ai_platform_engineering/integrations/slack_bot/utils/ai.py:118` — `stream_a2a_response()`

This is the core function (~730 lines). It:
1. Sets Slack typing indicator via `assistant_threads_setStatus()` (line 229)
2. Calls `a2a_client.send_message_stream()` (line 270) — initiates the A2A streaming request
3. Iterates over streamed events, parsing each with `parse_event()` (line 279)
4. Routes events to Slack rendering:

| A2A Artifact | Event Type | Slack Rendering |
|---|---|---|
| `streaming_result` | Token stream | `StreamBuffer.append()` → `chat_appendStream` (token-by-token) |
| `tool_notification_start` | Tool progress | Tool progress cards |
| `tool_notification_end` | Tool completion | Marks tool as completed |
| `execution_plan` | Plan steps | Plan step cards via `chat_appendStream` |
| `caipe_form` | HITL form | Interactive Slack form |
| `final_result` | Final answer | Authoritative final response |
| `status-update` | Completion | Completed/failed state |

#### 4. A2A Client

**File:** `ai_platform_engineering/integrations/slack_bot/a2a_client.py:153` — `A2AClient.send_message_stream()`

- Protocol: **A2A JSON-RPC 2.0** over HTTP with SSE streaming
- Endpoint: `POST {base_url}` (the base URL itself, no path suffix)
- Method: `message/stream`
- Auth: Optional Bearer token from OAuth2 + `X-Client-Source: slack-bot` header
- Parses SSE response, extracts JSON-RPC results, yields events with `kind` field

Also provides:
- `get_agent_card()` at `/.well-known/agent.json`
- `cancel_task()` via `tasks/cancel`

#### 5. Event Parsing

**File:** `ai_platform_engineering/integrations/slack_bot/utils/event_parser.py:86` — `parse_event()`

Classifies each A2A event by `kind`:
- `task` → `EventType.TASK`
- `message` → `EventType.MESSAGE`
- `status-update` → `EventType.STATUS_UPDATE`
- `artifact-update` → classified by artifact name (`streaming_result`, `final_result`, `partial_result`, `tool_notification_start`, `tool_notification_end`, `execution_plan`, `caipe_form`)

#### 6. Streaming to Slack

**File:** `ai_platform_engineering/integrations/slack_bot/utils/ai.py`

Two-leg streaming pipeline:

| Leg | Protocol | Details |
|-----|----------|---------|
| Backend → Bot | SSE over HTTP (A2A JSON-RPC) | Bot receives structured events |
| Bot → Slack | Slack Streaming API | `chat_startStream` / `chat_appendStream` / `chat_stopStream` |

- `StreamBuffer` (line 31) batches markdown text, flushes on newline boundaries or 1-second intervals
- Plan steps rendered as task update chunks with `task_display_mode="plan"`
- Finalized with `chat_stopStream()` + feedback buttons

**Fallback for bot users** (ID prefix `B`, cannot use Slack streaming):
- Regular `chat_postMessage` + throttled `chat_update` calls

### Key Characteristics

- **Protocol:** A2A JSON-RPC 2.0 (same backend as UI supervisor path)
- **Proxy:** None — Slack bot calls backend directly
- **Dynamic agents:** Not supported — Slack bot talks to supervisor only
- **Sub-agents:** Appear as tool notifications and plan steps in the A2A event stream; orchestration happens server-side within the supervisor
- **Two-leg streaming:** backend→bot (SSE) then bot→Slack (Slack streaming API)

---

## Comparison Table

| Aspect | UI → Supervisor | UI → Dynamic Agent | Slack → Supervisor |
|--------|----------------|--------------------|--------------------|
| **Protocol** | A2A JSON-RPC 2.0 | Custom SSE (or AG-UI) | A2A JSON-RPC 2.0 |
| **Client** | `A2ASDKClient` (TS) | `StreamAdapter` (TS) | `A2AClient` (Python) |
| **Proxy** | None (direct) | Next.js API route | None (direct) |
| **Backend endpoint** | `POST /chat/stream` | `POST /api/v1/chat/stream/start` | `POST /` |
| **Backend service** | `multi_agents/` supervisor | `dynamic_agents/` | `multi_agents/` supervisor |
| **Timeline** | `SupervisorTimelineManager` | `TimelineManager` + `useAgentTimeline` | N/A (Slack cards) |
| **Streaming to user** | Browser SSE → React | Browser SSE → React | Slack streaming API |
| **Dynamic agent support** | Via `selectedAgentId` in ChatPanel | Native | No |
| **HITL support** | `MetadataInputForm` in UI | `MetadataInputForm` in UI | Slack interactive forms |

---

## File Reference

### UI — Supervisor Path
| File | Role |
|------|------|
| `ui/src/components/chat/ChatContainer.tsx` | Routing: supervisor vs dynamic agent |
| `ui/src/components/chat/SupervisorChatView.tsx` | Thin wrapper with health check |
| `ui/src/components/chat/SupervisorChatPanel.tsx` | Message submission, A2A streaming loop, timeline building |
| `ui/src/lib/a2a-sdk-client.ts` | A2A JSON-RPC client wrapping `@a2a-js/sdk` |
| `ui/src/lib/supervisor-timeline-manager.ts` | Builds `SupervisorTimelineSegment[]` during streaming |
| `ui/src/lib/supervisor-timeline-parsers.ts` | Parses plan steps from A2A DataPart events |
| `ui/src/components/chat/SupervisorTimeline.tsx` | Renders supervisor timeline UI |
| `ui/src/store/chat-store.ts` | State management + MongoDB persistence |

### UI — Dynamic Agent Path
| File | Role |
|------|------|
| `ui/src/components/chat/ChatContainer.tsx` | Routing: supervisor vs dynamic agent |
| `ui/src/components/chat/ChatView.tsx` | Layout: ChatPanel + DynamicAgentContext |
| `ui/src/components/chat/ChatPanel.tsx` | Message submission, streaming adapter integration |
| `ui/src/lib/streaming/adapter.ts` | Factory: `createStreamAdapter()` |
| `ui/src/lib/streaming/custom-adapter.ts` | Custom SSE protocol adapter |
| `ui/src/lib/streaming/agui-adapter.ts` | AG-UI protocol adapter |
| `ui/src/lib/streaming/callbacks.ts` | `StreamCallbacks` interface |
| `ui/src/lib/streaming/parse-sse.ts` | SSE frame parser (Safari-compatible) |
| `ui/src/app/api/chat/conversations/[id]/stream/start/route.ts` | Next.js proxy route |
| `ui/src/app/api/chat/conversations/[id]/stream/_helpers.ts` | Auth + transparent SSE pipe |
| `ui/src/lib/timeline-manager.ts` | Builds `TimelineSegment[]` from stream events |
| `ui/src/hooks/useAgentTimeline.ts` | React hook: events → timeline data |
| `ui/src/components/chat/AgentTimeline.tsx` | Renders dynamic agent timeline UI |
| `ui/src/store/chat-store.ts` | State management + MongoDB persistence |

### Backend — Supervisor
| File | Role |
|------|------|
| `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/main.py` | A2A Starlette app, route setup, CORS |
| `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` | A2A executor → LangGraph supervisor |

### Backend — Dynamic Agents
| File | Role |
|------|------|
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py` | FastAPI route: `/api/v1/chat/stream/start` |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` | LangGraph agent runtime, streaming |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/encoders/` | `StreamEncoder` ABC, Custom/AGUI encoders |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/langgraph_stream_helpers.py` | LangGraph event processing |

### Slack Bot
| File | Role |
|------|------|
| `ai_platform_engineering/integrations/slack_bot/app.py` | Event handlers: `@mention`, DMs, Q&A |
| `ai_platform_engineering/integrations/slack_bot/utils/ai.py` | Streaming orchestrator: backend→Slack |
| `ai_platform_engineering/integrations/slack_bot/a2a_client.py` | A2A JSON-RPC client (Python) |
| `ai_platform_engineering/integrations/slack_bot/utils/event_parser.py` | A2A event classifier |
| `ai_platform_engineering/integrations/slack_bot/utils/slack_context.py` | Message text extraction, thread context |
| `ai_platform_engineering/integrations/slack_bot/utils/session_manager.py` | Conversation ID management |
