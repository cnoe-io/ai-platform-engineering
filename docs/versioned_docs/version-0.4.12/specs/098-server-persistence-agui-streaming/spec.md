# Server-Side Persistence & Unified Streaming Protocol Spec

## Overview

This document specifies a comprehensive refactor of the CAIPE platform's streaming and persistence architecture. The goals are:

1. **Server-authoritative persistence** - The supervisor persists all streaming data; UI and Slack become stateless consumers
2. **Unified streaming protocol** - AG-UI Protocol replaces all custom SSE/A2A streaming implementations
3. **Clean separation of concerns** - A2A for agent-to-agent, AG-UI for interface-to-agent

## Problem Statement

### Current State (Before Refactor)

The platform has fundamental design flaws:

1. **Client-side writes**: Both UI and Slack bot write directly to MongoDB instead of the server
   - UI accumulates events in Zustand store, periodically flushes via `saveMessagesToServer()`
   - Slack bot writes via `InteractionTracker`

2. **No single source of truth**: Server has no record of what was streamed
   - Page refresh during streaming loses data
   - Two different write paths produce inconsistent schemas

3. **Multiple streaming implementations**: 
   - A2A protocol used for both agent-to-agent AND interface-to-agent
   - Custom SSE implementations in UI and Slack
   - Complex event transformation layers

4. **Tight coupling**: Interfaces must understand internal agent event formats

### Target State (After Refactor)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Next.js UI    │     │   Slack Bot     │     │  Future Clients │
│  (React/Zustand)│     │   (Python)      │     │  (CLI, Mobile)  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  @ag-ui/client        │  ag-ui-protocol       │
         │  (TypeScript)         │  (Python)             │
         └───────────┬───────────┴───────────┬───────────┘
                     │                       │
                     │   AG-UI Events (SSE)  │
                     │                       │
              ┌──────▼───────────────────────▼──────┐
              │         AG-UI Event Emitter         │
              │       POST /api/agui/stream         │
              │                                     │
              │         TurnPersistence             │
              │    (writes to turns/stream_events)  │
              └──────────────────┬──────────────────┘
                                 │
                     A2A (Agent-to-Agent only)
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
┌────────▼────────┐    ┌────────▼────────┐    ┌────────▼────────┐
│    Platform     │    │   Sub-Agents    │    │     Future      │
│    Engineer     │    │  (Jira, GitHub) │    │     Agents      │
│   (LangGraph)   │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**Key principles:**
- **AG-UI** for all interface-to-agent communication (UI, Slack, CLI)
- **A2A** only for server-side agent-to-agent communication
- **Server persists everything** during streaming
- **Clients are stateless** - they consume events, don't write to DB

---

## Phase 1: Server-Side Persistence (COMPLETE)

### 1.1 TurnPersistence Service

**Location:** `ai_platform_engineering/utils/persistence/turn_persistence.py`

Two new MongoDB collections:

#### `turns` collection schema
```python
{
  "_id": str,                    # turn_id (UUID)
  "conversation_id": str,
  "sequence": int,               # ordering within conversation
  "user_message": {
    "message_id": str,
    "content": str,
    "sender_email": str | None,
    "created_at": datetime,
  },
  "assistant_message": {
    "message_id": str,
    "content": str,              # accumulated final content
    "created_at": datetime,
    "completed_at": datetime | None,
    "status": "streaming" | "completed" | "interrupted" | "waiting_for_input" | "failed",
  },
  "metadata": {
    "source": "web" | "slack",
    "agent_id": str | None,
    "trace_id": str | None,
    "model": str | None,
    "tokens_used": int | None,
    "latency_ms": int | None,
  },
  "created_at": datetime,
  "updated_at": datetime,
}
```

#### `stream_events` collection schema
```python
{
  "_id": str,                    # event_id (UUID)
  "turn_id": str,                # FK to turns._id
  "conversation_id": str,        # denormalized for direct queries
  "sequence": int,               # ordering within turn
  "type": "tool_start" | "tool_end" | "content" | "plan_update" | "input_required" | ...,
  "timestamp": datetime,
  "namespace": [str],            # agent hierarchy for subagent correlation
  "data": dict,                  # type-specific payload
  "created_at": datetime,
}
```

#### Methods
- `create_turn(conversation_id, user_message, metadata)` - creates turn with status "streaming"
- `append_event(turn_id, event_type, data, namespace)` - inserts into stream_events
- `append_content(turn_id, content)` - buffered content updates (every 10 chunks or 2s)
- `complete_turn(turn_id, final_content, status)` - finalizes turn
- `get_turns(conversation_id)` - read turns for rehydration
- `get_turn_events(turn_id)` - read events for a turn
- `get_conversation_events(conversation_id)` - all events for timeline rebuild

### 1.2 PersistedStreamHandler

**Location:** `ai_platform_engineering/multi_agents/platform_engineer/persisted_stream.py`

Wraps any async event stream with automatic persistence:
```python
class PersistedStreamHandler:
    async def stream_with_persistence(
        self,
        source: AsyncGenerator,      # Raw supervisor stream
        conversation_id: str,
        user_message: dict,
        metadata: dict,
    ) -> AsyncGenerator:
        # 1. create_turn() before first event
        # 2. append_event() for each event during streaming
        # 3. complete_turn() in finally block
        # 4. Yields events unchanged
```

### 1.3 Read Endpoints

**Location:** `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/turns_routes.py`

- `GET /api/v1/conversations/{conversation_id}/turns` - all turns
- `GET /api/v1/conversations/{conversation_id}/turns/{turn_id}` - single turn
- `GET /api/v1/conversations/{conversation_id}/turns/{turn_id}/events` - events for turn
- `GET /api/v1/conversations/{conversation_id}/events` - all events

### 1.4 Status: COMPLETE

- [x] TurnPersistence service created
- [x] PersistedStreamHandler created
- [x] Read endpoints created
- [x] Indexes added
- [x] Integrated into A2A executor

---

## Phase 2: Remove Client-Side Writes (COMPLETE)

### 2.1 UI Changes

**Removed:**
- `saveMessagesToServer()` function
- `serializeA2AEvent()`, `serializeSSEEvent()` helpers
- Periodic save logic, `beforeunload` save handlers
- `eventCountSinceLastSave`, `pendingSaveTimestamps` tracking

**Added:**
- `loadTurnsFromServer()` - fetches from new turns/events endpoints
- Stream recovery polling for in-progress turns on page refresh

### 2.2 Slack Bot Changes

**Removed:**
- `InteractionTracker` direct MongoDB writes (gutted to no-ops)
- Direct `db["conversations"]` and `db["messages"]` writes

**Added:**
- Slack metadata passed in request to server
- Server writes `source: "slack"` on turns

### 2.3 Status: COMPLETE

- [x] UI write operations removed
- [x] Slack bot direct writes removed
- [x] UI uses `loadTurnsFromServer()`
- [x] Stream recovery on refresh implemented

---

## Phase 3: Unified AG-UI Protocol (IN PROGRESS)

### 3.1 What is AG-UI?

AG-UI is an open, event-based protocol standardizing agent-to-UI communication:
- 16 standardized event types
- Transport agnostic (SSE, WebSocket, webhooks)
- Built-in support for streaming, tool calls, state sync, HITL
- Part of the agentic protocol stack (MCP for tools, A2A for agents, AG-UI for UIs)

**Documentation:** https://docs.ag-ui.com/introduction

### 3.2 AG-UI Event Types We'll Use

| AG-UI Event | Purpose | Replaces |
|-------------|---------|----------|
| `RUN_STARTED` | Stream begins | (new) |
| `RUN_FINISHED` | Stream complete | `done` |
| `RUN_ERROR` | Error occurred | `error` |
| `TEXT_MESSAGE_START` | New message begins | (new) |
| `TEXT_MESSAGE_CONTENT` | Streaming text chunk | `content` |
| `TEXT_MESSAGE_END` | Message complete | (implicit) |
| `TOOL_CALL_START` | Tool invocation begins | `tool_start` |
| `TOOL_CALL_ARGS` | Tool arguments streaming | (new) |
| `TOOL_CALL_END` | Tool invocation completes | `tool_end` |
| `STATE_SNAPSHOT` | Full state (reconnection) | (new) |
| `STATE_DELTA` | Incremental state update | `plan_update` |
| `CUSTOM` | HITL forms, warnings | `input_required` |

### 3.3 Backend Implementation

**New module:** `ai_platform_engineering/utils/agui/`
```
ai_platform_engineering/utils/agui/
├── __init__.py
├── event_types.py      # AG-UI event type enums
├── event_emitter.py    # Functions to create AG-UI events
├── encoder.py          # SSE encoding for AG-UI events
└── state.py            # STATE_SNAPSHOT/DELTA helpers
```

**Install:** `ag-ui-protocol` PyPI package

**Modify streaming handlers:**
- Platform Engineer: `protocol_bindings/sse/stream_handler.py`
- Dynamic Agents: `dynamic_agents/services/stream_events.py`

### 3.4 UI Implementation

**New module:** `ui/src/lib/agui/`
```
ui/src/lib/agui/
├── client.ts           # HttpAgent wrapper with auth
├── types.ts            # Re-export AG-UI types
└── hooks.ts            # useAGUIStream() hook
```

**Install:** `@ag-ui/client` npm package

**Modify:**
- `chat-store.ts` - Use AG-UI event types, simplify `sendMessage()`
- `timeline-manager.ts` - Parse AG-UI events for timeline
- `ChatPanel.tsx` - Remove legacy event handling

**Delete:**
- `ui/src/lib/sse-client.ts`
- `ui/src/lib/dynamic-agent-client.ts`
- `ui/src/types/a2a.ts`
- `ui/src/components/dynamic-agents/sse-types.ts`

### 3.5 Slack Bot Implementation

**Modify:**
- `utils/ai.py` - Parse AG-UI events instead of custom SSE events
- `sse_client.py` - Replace `SSEEventType` with AG-UI types

**Event mapping for Slack:**
| AG-UI Event | Slack Action |
|-------------|--------------|
| `TEXT_MESSAGE_CONTENT` | `chat_appendStream()` |
| `TOOL_CALL_START` | Update typing status |
| `TOOL_CALL_END` | Clear status |
| `STATE_DELTA` | Plan step update |
| `CUSTOM` (INPUT_REQUIRED) | Post Block Kit form |
| `RUN_FINISHED` | `chat_stopStream()` + feedback buttons |
| `RUN_ERROR` | Error message + retry button |

### 3.6 Stream Reconnection via STATE_SNAPSHOT

AG-UI has built-in support for reconnection via `STATE_SNAPSHOT`:

**On initial connect or reconnect:**
1. Server emits `STATE_SNAPSHOT` with full current state (conversation, in-progress turn, plan steps)
2. Client renders immediately from snapshot
3. Server continues with `STATE_DELTA` and `TEXT_MESSAGE_CONTENT` events

**Implementation:**
```python
# Backend: On connection, emit current state
async def handle_connect(conversation_id: str, turn_id: str | None):
    # If reconnecting to active stream
    if turn_id and is_turn_streaming(turn_id):
        yield AGUIEvent(
            type=EventType.STATE_SNAPSHOT,
            snapshot={
                "messages": get_messages_so_far(conversation_id),
                "currentTurn": get_turn_state(turn_id),
                "planSteps": get_plan_steps(turn_id),
            }
        )
        # Continue streaming from where we are
        async for event in continue_stream(turn_id):
            yield event
    else:
        # Normal new message flow
        yield AGUIEvent(type=EventType.RUN_STARTED, ...)
```

**Benefits over polling:**
- Instant state recovery (no 2-second poll intervals)
- No missed events during reconnect
- Native AG-UI pattern - clients expect this

**Replaces:** The current polling-based recovery in `loadTurnsFromServer()`

### 3.7 HITL via AG-UI

AG-UI `CUSTOM` events handle HITL:
```json
{
  "type": "CUSTOM",
  "name": "INPUT_REQUIRED",
  "data": {
    "interruptId": "form-123",
    "prompt": "Please provide deployment details",
    "fields": [
      {"name": "env", "type": "select", "options": ["dev", "staging", "prod"]},
      {"name": "confirm", "type": "boolean", "label": "Confirm deployment?"}
    ]
  }
}
```

User response sent as new message with reference to `interruptId`.

### 3.8 Status: IN PROGRESS

- [ ] Backend AG-UI emitter module
- [ ] Platform Engineer streaming updated
- [ ] Dynamic Agents streaming updated
- [ ] UI AG-UI client integration
- [ ] Slack bot AG-UI parsing
- [ ] HITL via AG-UI CUSTOM events
- [ ] Stream reconnection via STATE_SNAPSHOT
- [ ] Delete legacy SSE code

---

## Phase 4: Migration Scripts (COMPLETE)

**Location:** `scripts/migrations/0.4.0/`

### 4.1 migrate_messages_to_turns.py
- Pairs user/assistant messages into turns
- Normalizes a2a_events/sse_events into stream_events
- Idempotent with `--dry-run` flag

### 4.2 migrate_conversations_schema.py
- Adds `source: "web"` or `source: "slack"` to conversations
- Normalizes metadata structure

### 4.3 migrate_slack_sessions.py
- Merges slack_sessions data into conversations.slack_meta

### 4.4 Status: COMPLETE

- [x] migrate_messages_to_turns.py
- [x] migrate_conversations_schema.py
- [x] migrate_slack_sessions.py

---

## What Gets Deleted

### Already Deleted (Phase 2)
- `ui/src/lib/a2a-client.ts`
- `ui/src/lib/a2a-sdk-client.ts`
- `ui/src/hooks/use-a2a-streaming.ts`
- `ai_platform_engineering/integrations/slack_bot/a2a_client.py`
- `stream_a2a_response()` from Slack bot

### To Delete (Phase 3)
- `ui/src/lib/sse-client.ts` - Replace with AG-UI client
- `ui/src/lib/dynamic-agent-client.ts` - Replace with AG-UI client
- `ui/src/types/a2a.ts` - Replace with AG-UI types
- `ui/src/components/dynamic-agents/sse-types.ts` - Replace with AG-UI types
- `ai_platform_engineering/integrations/slack_bot/sse_client.py` - Replace with AG-UI types
- Custom SSE event formatting in stream handlers

---

## Protocol Responsibilities

| Protocol | Scope | Used By |
|----------|-------|---------|
| **AG-UI** | Interface ↔ Supervisor | UI, Slack bot, CLI, Mobile |
| **A2A** | Agent ↔ Agent | Supervisor ↔ Sub-agents (Jira, GitHub, etc.) |
| **MCP** | Agent ↔ Tools | Agents ↔ MCP tool servers |

**Key insight:** A2A is NEVER used by UI or Slack. They only speak AG-UI.

---

## Verification Checklist

### Functional Tests
- [ ] Send message from UI → response streams correctly
- [ ] Refresh page mid-stream → reconnects and shows progress
- [ ] Refresh after complete → loads full conversation from turns
- [ ] Tool calls display correctly in timeline
- [ ] Execution plan updates in real-time
- [ ] HITL forms work in UI
- [ ] HITL forms work in Slack
- [ ] Error states handled gracefully

### Data Integrity
- [ ] Turns persisted with correct schema
- [ ] Stream events persisted with sequence numbers
- [ ] Content accumulation works (buffered writes)
- [ ] Turn status transitions: streaming → completed/failed/waiting_for_input

### Slack-Specific
- [ ] Mentions trigger response
- [ ] Q&A threads work
- [ ] DMs work
- [ ] Alerts process correctly
- [ ] Escalation flows work
- [ ] Feedback buttons work

---

## Future: CopilotKit Integration

AG-UI is the foundation that enables CopilotKit:

1. **Now**: Use `@ag-ui/client` directly for protocol compliance
2. **Later**: Add `@copilotkit/react-core` for higher-level hooks (`useCoAgent()`)
3. **Optional**: Add `@copilotkit/react-ui` for pre-built chat components

CopilotKit consumes AG-UI events, so backend work carries forward.

---

## References

- [AG-UI Protocol Documentation](https://docs.ag-ui.com/introduction)
- [AG-UI Python SDK](https://pypi.org/project/ag-ui-protocol/)
- [AG-UI TypeScript Client](https://www.npmjs.com/package/@ag-ui/client)
- [A2A Protocol](https://a2aprotocol.org/)
- [MCP Protocol](https://modelcontextprotocol.io/)
