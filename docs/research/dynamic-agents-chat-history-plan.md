# Dynamic Agents Chat History — Implementation Plan

**Date:** 2026-03-17
**Status:** Approved
**Related research:**
- [ui-chat-storage-vs-langgraph-checkpointer.md](./ui-chat-storage-vs-langgraph-checkpointer.md)
- [mongodb-checkpointer-integration.md](./mongodb-checkpointer-integration.md)
- [dynamic-agents-hybrid-storage-design.md](./dynamic-agents-hybrid-storage-design.md)

---

## Goal

Give Dynamic Agent conversations persistent, reloadable chat history by:

1. Storing **conversation metadata** (title, owner, sharing) in the existing MongoDB `conversations` collection so the sidebar listing continues to work unchanged.
2. Storing **message history** in LangGraph's `MongoDBSaver` checkpointer so the agent's full state (messages, tool calls, HITL interrupts) survives pod restarts.
3. Adding a dedicated **`DynamicAgentChatPanel`** component that loads history directly from the backend instead of from the UI's `messages` collection.

`ChatPanel.tsx` is **not modified** — it keeps serving the Platform Engineer (A2A) flow exactly as today.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New UI component | Extract only DA logic (not a full copy) | Smaller, no dead A2A code paths |
| Checkpointer | Global singleton via existing `get_checkpointer()` | Reuses connection pool, already tested |
| Conversation metadata creation | Backend creates record on first message | Avoids orphan records from abandoned new-chat screens |
| `messages` collection | Dynamic Agents do **not** write to it | Single source of truth = checkpointer |
| `ChatPanel.tsx` | No changes | Avoids conflicts with other contributors |

---

## Phase 1 — DynamicAgentChatPanel (UI)

**Scope:** UI only. Backend unchanged. Behaviour is identical to the current Dynamic Agent tab inside `ChatPanel`, just isolated in its own component.

### What to build

**New file:** `ui/src/components/chat/DynamicAgentChatPanel.tsx`

Extract and keep from `ChatPanel.tsx`:
- `DynamicAgentClient` streaming loop (SSE events)
- SSE event handling (`clearSSEEvents`, `addSSEEvent`, event buffer + throttle)
- HITL handling for the SSE/Dynamic Agent path (`isSSE: true`)
- Message rendering (copy the render helpers verbatim)
- Input area, auto-scroll, copy button, feedback button

Remove (not needed for Dynamic Agents):
- `A2ASDKClient` import and usage
- A2A event handling (`toStoreEvent`, `addA2AEvent`, `clearA2AEvents`)
- A2A HITL path (`contextId` branch)
- `@`-mention menu (Platform Engineer only)
- `CustomCallButtons` / `DEFAULT_AGENTS`

**Props:**
```typescript
interface DynamicAgentChatPanelProps {
  agentId: string;           // Dynamic Agent ID
  conversationId?: string;   // MongoDB conversation UUID
  endpoint: string;          // Kept for parity; used for proxy base URL
  readOnly?: boolean;
  readOnlyReason?: ReadOnlyReason;
}
```

### Where to wire it in

In the parent that currently passes `selectedAgentId` to `ChatPanel`, replace with a conditional:

```tsx
{selectedAgentId ? (
  <DynamicAgentChatPanel
    agentId={selectedAgentId}
    conversationId={activeConversationId}
    endpoint={endpoint}
  />
) : (
  <ChatPanel endpoint={endpoint} conversationId={activeConversationId} />
)}
```

### Files changed in Phase 1

| File | Change |
|------|--------|
| `ui/src/components/chat/DynamicAgentChatPanel.tsx` | **Create** |
| Parent component (e.g. `PlatformEngineerChatView.tsx`) | Conditional render |
| `ui/src/components/chat/ChatPanel.tsx` | **No changes** |

### Acceptance criteria

- Sending a message to a Dynamic Agent works exactly as before
- HITL (user input form) still appears and submits
- No regressions on the Platform Engineer / A2A flow

---

## Phase 2 — MongoDBSaver Checkpointer (Backend)

**Scope:** Backend only. UI unchanged. Conversations now survive pod restarts.

### What to change

**`agent_runtime.py` — replace `InMemorySaver`**

```python
# Before
from langgraph.checkpoint.memory import InMemorySaver
self._checkpointer = InMemorySaver()

# After
from ai_platform_engineering.utils.checkpointer import get_checkpointer
self._checkpointer = get_checkpointer()   # MongoDBSaver when env var is set
```

`get_checkpointer()` already exists in `ai_platform_engineering/utils/checkpointer.py` and returns a `_LazyAsyncMongoDBSaver` when `LANGGRAPH_CHECKPOINT_TYPE=mongodb`. It falls back to `InMemorySaver` if the env var is absent, so no existing deployments break.

### Environment variables to add to Dynamic Agents deployment

```bash
LANGGRAPH_CHECKPOINT_TYPE=mongodb
LANGGRAPH_CHECKPOINT_MONGODB_URI=mongodb://...   # same URI used by the rest of the platform
```

### MongoDB collections created automatically by MongoDBSaver

| Collection | Purpose |
|------------|---------|
| `checkpoints` | Full LangGraph state per thread (messages, tool calls, channel values) |
| `checkpoint_writes` | Intermediate writes — enables crash recovery mid-node |

### Files changed in Phase 2

| File | Change |
|------|--------|
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` | Replace `InMemorySaver` with `get_checkpointer()` |
| `charts/` or `docker-compose/` dynamic-agents config | Add `LANGGRAPH_CHECKPOINT_TYPE` + `LANGGRAPH_CHECKPOINT_MONGODB_URI` |

### Acceptance criteria

- After a pod restart, continuing an existing conversation replays correctly
- Multiple simultaneous conversations do not interfere (isolated by `thread_id = conversation_id`)
- HITL interrupt state persists across restarts
- Fallback to `InMemorySaver` still works when env var is unset

---

## Phase 3 — Persistent History in DynamicAgentChatPanel (Integration)

**Scope:** Backend new endpoint + UI update. History now loads from the LangGraph checkpointer instead of the UI `messages` collection.

### 3a — Backend: conversation metadata sync

**`routes/chat.py`** — add `_ensure_conversation_exists()` and call it at the start of every stream:

```python
async def _ensure_conversation_exists(
    conversation_id: str,
    agent_id: str,
    owner_id: str,
    agent_name: str,
) -> None:
    """
    Upsert a lightweight metadata record in the `conversations` collection.
    This makes the conversation appear in the UI sidebar without storing
    any messages here — messages live in the LangGraph checkpointer.
    """
    db = get_mongo_db()
    await db["conversations"].update_one(
        {"_id": conversation_id},
        {
            "$setOnInsert": {
                "_id": conversation_id,
                "title": f"Chat with {agent_name}",
                "owner_id": owner_id,
                "agent_id": agent_id,
                "created_at": datetime.utcnow(),
                "metadata": {"agent_version": "1.0", "model_used": "", "total_messages": 0},
                "sharing": {"is_public": False, "shared_with": [], "shared_with_teams": [], "share_link_enabled": False},
                "tags": [],
                "is_archived": False,
                "is_pinned": False,
            },
            "$set": {"updated_at": datetime.utcnow()},
        },
        upsert=True,
    )
```

Call site inside `_generate_sse_events()`:
```python
await _ensure_conversation_exists(
    conversation_id=session_id,
    agent_id=agent_config.id,
    owner_id=user_id,
    agent_name=agent_config.name,
)
```

### 3b — Backend: new thread state endpoint

**New file:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/threads.py`

```
GET /api/v1/threads/{thread_id}/state?agent_id=<id>
```

Steps inside the handler:
1. Verify the requesting user owns (or has access to) the conversation via the `conversations` collection.
2. Get or create the `AgentRuntime` from `AgentRuntimeCache`.
3. Call `await runtime._graph.aget_state({"configurable": {"thread_id": thread_id}})`.
4. Filter to `HumanMessage` and `AIMessage` only (skip `ToolMessage` / `SystemMessage` in Phase 3; these can be surfaced in Phase 4).
5. Return a typed response:

```python
class ThreadMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    timestamp: datetime

class ThreadStateResponse(BaseModel):
    thread_id: str
    messages: list[ThreadMessage]
    has_pending_interrupt: bool
    interrupt_data: dict | None = None
```

Register the router in `main.py`:
```python
from dynamic_agents.routes.threads import router as threads_router
app.include_router(threads_router, prefix="/api/v1")
```

### 3c — UI: Next.js proxy route

**New file:** `ui/src/app/api/dynamic-agents/threads/[id]/state/route.ts`

```typescript
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  // 1. Validate session
  // 2. Forward to DYNAMIC_AGENTS_URL/api/v1/threads/{id}/state
  //    with X-User-Email header
  // 3. Return response as-is
}
```

### 3d — UI: update DynamicAgentChatPanel

Replace the current `loadMessagesFromServer()` call on mount with:

```typescript
const loadHistory = useCallback(async () => {
  if (!conversationId || !agentId) return;
  const res = await fetch(
    `/api/dynamic-agents/threads/${conversationId}/state?agent_id=${agentId}`
  );
  const data: ThreadStateResponse = await res.json();
  // hydrate local message state from data.messages
  // if data.has_pending_interrupt → restore HITL form
}, [conversationId, agentId]);

useEffect(() => { loadHistory(); }, [loadHistory]);
```

`saveMessagesToServer()` calls are **removed** — messages are stored exclusively in the checkpointer.

### Files changed in Phase 3

| File | Change |
|------|--------|
| `routes/chat.py` | Add `_ensure_conversation_exists()`, call in `_generate_sse_events()` |
| `routes/threads.py` | **Create** — `GET /api/v1/threads/{thread_id}/state` |
| `main.py` | Register `threads_router` |
| `ui/src/app/api/dynamic-agents/threads/[id]/state/route.ts` | **Create** — Next.js proxy |
| `ui/src/components/chat/DynamicAgentChatPanel.tsx` | Load history from new API; remove `saveMessagesToServer` |

### Acceptance criteria

- Opening an existing Dynamic Agent conversation loads full message history
- History survives pod restart (depends on Phase 2 being deployed)
- Conversations appear in the sidebar list (from `conversations` collection)
- Existing Platform Engineer conversations are unaffected
- HITL interrupt is restored when reloading a conversation mid-flow

---

## Phase 4 — UX Improvements (TBD)

To be scoped in a follow-up discussion. Likely candidates:

- **Conversation title generation** — use first user message (truncated) or a fast LLM call
- **Tool call visibility** — surface `ToolMessage` events in the panel (collapsible)
- **Timestamps** — store `timestamp` in `additional_kwargs` when messages are created, surface in UI
- **Conversation deletion** — soft-delete metadata + TTL-expire checkpoints
- **Shared conversations** — store `sender_email` in `additional_kwargs` for attribution

---

## Full File Inventory

| File | Phase | Create / Modify |
|------|-------|-----------------|
| `ui/src/components/chat/DynamicAgentChatPanel.tsx` | 1 | Create |
| Parent chat view (wires conditional render) | 1 | Modify |
| `services/agent_runtime.py` | 2 | Modify |
| Helm chart / docker-compose env vars | 2 | Modify |
| `routes/chat.py` | 3 | Modify |
| `routes/threads.py` | 3 | Create |
| `main.py` | 3 | Modify |
| `ui/src/app/api/dynamic-agents/threads/[id]/state/route.ts` | 3 | Create |
| `ui/src/components/chat/DynamicAgentChatPanel.tsx` | 3 | Modify |
| `ui/src/components/chat/ChatPanel.tsx` | — | **Never touched** |
