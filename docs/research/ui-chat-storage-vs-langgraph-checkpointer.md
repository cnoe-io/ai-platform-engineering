# UI Chat Storage vs LangGraph Checkpointer

**Date:** 2026-03-16  
**Status:** Research Complete  
**Related:** [mongodb-checkpointer-integration.md](./mongodb-checkpointer-integration.md)

## Overview

This document investigates how the UI maintains conversation history separately from the agent's LangGraph state, and assesses the feasibility of consolidating them using the MongoDB checkpointer as a single source of truth.

## Current Architecture: Dual Storage

Currently, chat messages are stored in **two independent locations**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CURRENT ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐          SSE Events           ┌──────────────────┐    │
│  │   Next.js   │ ◄──────────────────────────── │  Dynamic Agents  │    │
│  │     UI      │                               │     Backend      │    │
│  └──────┬──────┘                               └────────┬─────────┘    │
│         │                                               │              │
│         │ saveMessagesToServer()                        │              │
│         ▼                                               ▼              │
│  ┌─────────────────────┐                    ┌─────────────────────┐   │
│  │  MongoDB            │                    │   InMemorySaver     │   │
│  │  ├─ conversations   │                    │   (LangGraph)       │   │
│  │  └─ messages        │                    │                     │   │
│  │                     │                    │   Lost on restart!  │   │
│  │  UI-formatted data  │                    │   Agent state only  │   │
│  └─────────────────────┘                    └─────────────────────┘   │
│                                                                         │
│         ▲                                                              │
│         │ loadMessagesFromServer()                                     │
│         │ (on page load / conversation open)                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1. UI MongoDB Storage (Persistent)

**Collections:** `conversations`, `messages`

**Location:** Managed by Next.js API routes in `ui/src/app/api/chat/`

**Message Format (UI):**
```typescript
interface ChatMessage {
  id: string;                    // Client-generated UUID
  message_id?: string;           // For cross-reference
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;               // Full text content
  created_at: Date;
  sender_email?: string;         // For shared conversations
  sender_name?: string;
  sender_image?: string;
  metadata: {
    turn_id: string;             // Links user message to response
    model?: string;
    tokens_used?: number;
    latency_ms?: number;
    agent_name?: string;
    is_final?: boolean;
    task_id?: string;            // A2A task ID for recovery
    is_interrupted?: boolean;
  };
  artifacts?: Artifact[];
  a2a_events?: any[];           // Serialized A2A/SSE events
  feedback?: MessageFeedback;
}
```

**Key files:**
- `ui/src/store/chat-store.ts` - Zustand store with `saveMessagesToServer()`, `loadMessagesFromServer()`
- `ui/src/app/api/chat/conversations/[id]/messages/route.ts` - CRUD API
- `ui/src/lib/api-client.ts` - API client wrapper

### 2. LangGraph InMemorySaver (Ephemeral)

**Location:** Per-runtime instance in `AgentRuntime._checkpointer`

**Message Format (LangGraph):**
```python
# Checkpoint structure
{
    "v": 1,
    "id": "1ef4f797-8335-6428-8001-8a1503f9b875",
    "ts": "2026-03-16T20:14:19.804150+00:00",
    "channel_values": {
        "messages": [
            # LangChain message objects
            HumanMessage(content="hello", id="msg-1"),
            AIMessage(content="Hi!", tool_calls=[...], id="msg-2"),
            ToolMessage(content="result", tool_call_id="call-1"),
            ...
        ],
        # Other channels: files, todos, etc.
    },
    "channel_versions": {...},
    "versions_seen": {...},
}
```

**Key insight:** The LangGraph checkpoint stores the **full message history** including:
- All user messages (`HumanMessage`)
- All assistant responses (`AIMessage`)
- All tool calls and results (`ToolMessage`)
- Pending interrupts for HITL
- File state (if using StateBackend)
- Todo list state

## Data Flow Analysis

### Current Flow (UI Stores Separately)

```
1. USER SENDS MESSAGE
   Browser → Dynamic Agents Backend
   
2. BACKEND PROCESSES (LangGraph)
   - Loads checkpoint for thread_id (InMemorySaver)
   - Appends HumanMessage to state.messages
   - Agent processes, generates AIMessage
   - Streams SSE events to UI
   - Saves checkpoint (InMemorySaver - in memory only)
   
3. UI RECEIVES SSE EVENTS
   - Accumulates content chunks
   - Tracks tool calls, todos, artifacts
   - Builds ChatMessage objects locally
   
4. UI PERSISTS TO MONGODB
   - After streaming completes (or periodically)
   - saveMessagesToServer() upserts all messages
   - Serializes A2A events for debug panel
   
5. ON PAGE RELOAD
   - loadMessagesFromServer() fetches from MongoDB
   - Deserializes events, rebuilds local state
   - Agent has NO MEMORY (InMemorySaver was lost)
```

### Why the Disconnection Exists

1. **Historical**: The UI was built before MongoDB checkpointer was available
2. **Independence**: UI needed to work offline/localStorage mode
3. **Rich metadata**: UI stores additional fields (feedback, sender info, events)
4. **Display optimization**: UI format is optimized for rendering

## Feasibility Assessment: Single Source of Truth

### Option A: Use LangGraph Checkpointer as Primary Storage

**Approach:** Replace UI's MongoDB storage with reads from LangGraph checkpoint.

**Pros:**
- Single source of truth
- Agent and UI always in sync
- No duplicate storage
- Simpler architecture

**Cons (Significant):**

| Issue | Severity | Explanation |
|-------|----------|-------------|
| **Schema mismatch** | High | LangChain messages are optimized for LLM context, not UI display. Missing: `turnId`, `feedback`, `sender_*`, `artifacts`, `a2a_events`, `is_final`, `task_id` |
| **No UI metadata** | High | LangGraph doesn't store feedback, sharing, user attribution |
| **Checkpoint format opaque** | Medium | Checkpoints use msgpack serialization, not easily queryable |
| **No conversation-level metadata** | High | Title, tags, archived, pinned, sharing - all missing |
| **Multiple agent types** | Medium | Platform Engineer (A2A) and Dynamic Agents have different event formats |
| **localStorage fallback** | Medium | UI needs to work without MongoDB |
| **Migration complexity** | High | Would need to migrate all existing conversations |

**Verdict: Not Feasible** - The schemas serve different purposes. LangGraph stores LLM context; UI stores user-facing data with rich metadata.

### Option B: Hybrid - Checkpointer for Agent, MongoDB for UI (Current)

**Keep the current dual-storage approach but add MongoDB checkpointer for persistence.**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PROPOSED ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐          SSE Events           ┌──────────────────┐    │
│  │   Next.js   │ ◄──────────────────────────── │  Dynamic Agents  │    │
│  │     UI      │                               │     Backend      │    │
│  └──────┬──────┘                               └────────┬─────────┘    │
│         │                                               │              │
│         │                                               │              │
│         ▼                                               ▼              │
│  ┌─────────────────────┐                    ┌─────────────────────┐   │
│  │  MongoDB            │                    │   MongoDBSaver      │   │
│  │  ├─ conversations   │                    │   (LangGraph)       │   │
│  │  ├─ messages        │                    │   ├─ checkpoints    │   │
│  │  │                  │                    │   └─ checkpoint_    │   │
│  │  │  UI-formatted    │                    │       writes        │   │
│  │  │  (display)       │                    │   Agent state       │   │
│  │  │                  │                    │   (LLM context)     │   │
│  └─────────────────────┘                    └─────────────────────┘   │
│                                                                         │
│         ▲                                               ▲              │
│         │                                               │              │
│  loadMessagesFromServer()               checkpointer.aget(thread_id)   │
│  (page load)                            (on each agent invocation)     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Each storage serves its purpose
- Agent memory persists across restarts
- UI retains rich metadata and display optimization
- No migration needed for existing conversations
- Backward compatible

**Cons:**
- Slight data duplication (content in both places)
- Two collections to maintain

**Verdict: Recommended** - This is the pragmatic approach.

### Option C: Forked Codebase - Checkpointer as Single Source of Truth

**Approach:** If we forked Dynamic Agents (no backward compatibility), could we store everything in the LangGraph checkpointer?

**Key Insight:** LangChain messages support `additional_kwargs` for custom metadata:

```python
from langchain_core.messages import HumanMessage, AIMessage

# User message with UI metadata
user_msg = HumanMessage(
    content="hello",
    id="msg-uuid-123",
    additional_kwargs={
        "sender_email": "user@example.com",
        "sender_name": "John Doe",
        "turn_id": "turn-123",
        "timestamp": "2026-03-16T10:00:00Z"
    }
)

# Assistant message with feedback
ai_msg = AIMessage(
    content="Hi there!",
    id="msg-uuid-456",
    additional_kwargs={
        "feedback": {"type": "like", "comment": "helpful"},
        "artifacts": [...],
        "is_final": True
    }
)
```

**What CAN be stored in checkpointer:**

| Data | Storage Location | Notes |
|------|------------------|-------|
| Message content | `msg.content` | Native |
| Message ID | `msg.id` | Native |
| Role | Message type (Human/AI/Tool) | Native |
| Tool calls | `AIMessage.tool_calls` | Native |
| Sender info | `msg.additional_kwargs` | Custom |
| Turn ID | `msg.additional_kwargs` | Custom |
| Feedback | `msg.additional_kwargs` | Custom |
| Artifacts | `msg.additional_kwargs` | Custom |
| Timestamp | `msg.additional_kwargs` | Custom |

**What CANNOT be stored in checkpointer (requires separate storage):**

| Data | Why | Solution |
|------|-----|----------|
| Conversation title | Not message-level | Separate `conversations` collection |
| Sharing settings | Not message-level | Separate `conversations` collection |
| Tags, archive, pinned | Not message-level | Separate `conversations` collection |
| Owner ID | Not message-level | Separate `conversations` collection |
| Agent ID | Could use checkpoint namespace | Or separate collection |
| Conversation list | Checkpointer can't list by user | Separate index/collection |

**Critical Limitation: Listing Conversations**

The checkpointer `list()` method only supports:
```python
checkpointer.list(
    config={"configurable": {"thread_id": "..."}},  # Required!
    filter={"source": "input"},  # Limited filters
    limit=10
)
```

You **cannot** query: "Give me all conversations for user X" - there's no user-level index.

**Architecture for Forked Approach:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   FORKED ARCHITECTURE (Single Source)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐                               ┌──────────────────┐    │
│  │   Next.js   │ ◄──────── SSE Events ──────── │  Dynamic Agents  │    │
│  │     UI      │                               │     Backend      │    │
│  └──────┬──────┘                               └────────┬─────────┘    │
│         │                                               │              │
│         │ GET /conversations (list)                     │              │
│         │ PUT /conversations/:id (metadata)             │              │
│         ▼                                               ▼              │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                         MongoDB                                   │  │
│  │  ┌─────────────────────┐    ┌────────────────────────────────┐  │  │
│  │  │  conversations      │    │  langgraph_checkpoints         │  │  │
│  │  │  (metadata only)    │    │  (messages + UI metadata)      │  │  │
│  │  │  ├─ _id (thread_id) │◄──►│  ├─ thread_id                  │  │  │
│  │  │  ├─ title           │    │  ├─ channel_values.messages    │  │  │
│  │  │  ├─ owner_id        │    │  │   └─ additional_kwargs      │  │  │
│  │  │  ├─ agent_id        │    │  │       ├─ sender_*           │  │  │
│  │  │  ├─ sharing         │    │  │       ├─ feedback           │  │  │
│  │  │  ├─ tags            │    │  │       └─ artifacts          │  │  │
│  │  │  └─ is_archived     │    │  └─ ts, channel_versions, etc  │  │  │
│  │  └─────────────────────┘    └────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key Changes Required:**

1. **Backend: Inject UI metadata into messages**
   ```python
   # When receiving user message
   user_msg = HumanMessage(
       content=request.message,
       id=str(uuid4()),
       additional_kwargs={
           "sender_email": user_context.email,
           "sender_name": user_context.name,
           "turn_id": str(uuid4()),
           "timestamp": datetime.utcnow().isoformat()
       }
   )
   ```

2. **Backend: New API for UI to read messages**
   ```python
   @router.get("/api/v1/conversations/{conversation_id}/messages")
   async def get_messages(conversation_id: str):
       config = {"configurable": {"thread_id": conversation_id}}
       checkpoint = await checkpointer.aget_tuple(config)
       if not checkpoint:
           raise HTTPException(404)
       
       messages = checkpoint.checkpoint["channel_values"].get("messages", [])
       return [
           {
               "id": msg.id,
               "role": "user" if msg.type == "human" else "assistant",
               "content": msg.content,
               "timestamp": msg.additional_kwargs.get("timestamp"),
               "sender_email": msg.additional_kwargs.get("sender_email"),
               "feedback": msg.additional_kwargs.get("feedback"),
               # ... etc
           }
           for msg in messages
           if msg.type in ("human", "ai")  # Skip tool messages
       ]
   ```

3. **Backend: API to update message metadata (feedback)**
   ```python
   @router.put("/api/v1/conversations/{conversation_id}/messages/{message_id}/feedback")
   async def update_feedback(conversation_id: str, message_id: str, feedback: dict):
       # Get current state
       config = {"configurable": {"thread_id": conversation_id}}
       state = await graph.aget_state(config)
       
       # Find and update the message
       messages = state.values["messages"]
       for msg in messages:
           if msg.id == message_id:
               msg.additional_kwargs["feedback"] = feedback
               break
       
       # Update state (triggers checkpoint)
       await graph.aupdate_state(config, {"messages": messages})
   ```

4. **Lightweight `conversations` collection** (metadata only):
   ```python
   # No messages stored here - just metadata for listing/filtering
   {
       "_id": "conv-uuid",  # Same as thread_id
       "owner_id": "user@example.com",
       "agent_id": "code-reviewer",
       "title": "Code Review Discussion",
       "created_at": datetime,
       "updated_at": datetime,
       "sharing": {...},
       "tags": [...],
       "is_archived": False
   }
   ```

**Pros of Forked Approach:**
- Single source of truth for messages
- Agent and UI always in sync
- No message duplication
- Cleaner architecture

**Cons of Forked Approach:**
- Still need `conversations` collection for metadata
- More complex backend (metadata injection, state updates)
- `additional_kwargs` can get cluttered
- Breaking change for existing users
- Need to handle ToolMessage filtering (UI doesn't show these)

**Verdict: Feasible but Not Zero-Cost**

If forking, this is a viable approach. However:
- You still need a `conversations` collection for list/filter/metadata
- The complexity shifts to the backend (injecting metadata, state updates)
- It's a breaking change requiring migration

### Option D: UI Reads History from Checkpointer (Original Analysis)

**Approach:** On page load, UI fetches messages from checkpointer via a new API endpoint.

**New endpoint:**
```python
@router.get("/api/v1/chat/history/{conversation_id}")
async def get_chat_history(conversation_id: str):
    config = {"configurable": {"thread_id": conversation_id}}
    state = await runtime._graph.aget_state(config)
    messages = state.values.get("messages", [])
    
    # Convert LangChain messages to UI format
    return [
        {
            "id": msg.id,
            "role": "user" if isinstance(msg, HumanMessage) else "assistant",
            "content": msg.content,
            "timestamp": extract_timestamp(msg),
            # Missing: feedback, sender_*, artifacts, events, turn_id...
        }
        for msg in messages
    ]
```

**Problems:**
1. **Lossy conversion**: Can't reconstruct UI metadata from LangChain messages
2. **No historical data**: Checkpoints expire (TTL) or get cleaned up
3. **Performance**: State retrieval is heavier than MongoDB query
4. **Agent must exist**: Runtime must be cached to access checkpointer

**Verdict: Not Recommended** - Too many limitations without the forked approach modifications.

## Recommendation

**Continue with Option B (Hybrid Architecture)** with these enhancements:

### Phase 1: Add MongoDB Checkpointer (Existing Plan)
As documented in [mongodb-checkpointer-integration.md](./mongodb-checkpointer-integration.md):
- Replace `InMemorySaver` with `MongoDBSaver`
- Agent memory persists across restarts
- Collections: `langgraph_checkpoints`, `langgraph_checkpoint_writes`

### Phase 2: Ensure Thread ID Consistency
Both systems must use the same `conversation_id`:
- UI uses `conversation.id` (UUID)
- Backend must use same ID as `thread_id` for checkpointer
- **Already correct:** `ChatRequest.conversation_id` → `config["thread_id"]`

### Phase 3: Optional - Read-Through for Cold Start
If a conversation exists in UI MongoDB but not in checkpointer (e.g., TTL expired):
```python
# When checkpointer returns empty state but UI has history
if not checkpoint_messages and ui_has_messages:
    # Reconstruct minimal LangGraph state from UI messages
    messages = [
        HumanMessage(content=m.content) if m.role == "user" 
        else AIMessage(content=m.content)
        for m in ui_messages
    ]
    # Inject into agent state
    await runtime._graph.aupdate_state(config, {"messages": messages})
```

**Caveat:** This loses tool call history, but preserves conversation context.

## Data Comparison

| Field | UI MongoDB (`messages`) | LangGraph Checkpoint |
|-------|-------------------------|---------------------|
| Message ID | `message_id` (UUID) | `msg.id` (UUID) |
| Role | `role` (user/assistant) | Message type (Human/AI/Tool) |
| Content | `content` (string) | `msg.content` (string) |
| Timestamp | `created_at` (Date) | Derived from checkpoint `ts` |
| Tool calls | Serialized in `a2a_events` | Native `tool_calls` array |
| Tool results | Serialized in `a2a_events` | `ToolMessage` objects |
| Feedback | `feedback` object | **Not stored** |
| Sender info | `sender_*` fields | **Not stored** |
| Turn grouping | `turn_id` | **Not stored** |
| Display metadata | `artifacts`, `widgets` | **Not stored** |
| Task recovery | `task_id`, `is_interrupted` | **Not stored** |

## Summary

### Why UI Stores Chats Separately

1. **UI was built first** - Before LangGraph checkpointer existed
2. **Rich metadata** - Feedback, sharing, sender attribution, turn grouping
3. **Display optimization** - Format designed for rendering, not LLM context
4. **Offline support** - localStorage fallback when MongoDB unavailable
5. **Query flexibility** - Search, tags, archiving, soft delete

### Is Consolidation Feasible?

**No, full consolidation is not practical** because:
- Different schemas serve different purposes
- LangGraph checkpoints don't store UI metadata
- Would lose feedback, sharing, and display data

### What Should We Do?

1. **Keep dual storage** - Each serves its purpose
2. **Add MongoDBSaver** - So agent memory survives restarts
3. **Maintain ID consistency** - Same `conversation_id` in both systems
4. **Optional: Read-through** - Reconstruct agent state from UI if checkpoint expired

## Files Referenced

| File | Purpose |
|------|---------|
| `ui/src/store/chat-store.ts` | Zustand store, `saveMessagesToServer()`, `loadMessagesFromServer()` |
| `ui/src/app/api/chat/conversations/[id]/messages/route.ts` | Messages CRUD API |
| `ui/src/types/a2a.ts` | `ChatMessage`, `Conversation` interfaces |
| `ui/src/types/mongodb.ts` | MongoDB `Message` interface |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` | `InMemorySaver` usage |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py` | Chat streaming endpoints |

## References

- [LangGraph Persistence Documentation](https://docs.langchain.com/oss/python/langgraph/persistence)
- [langgraph-checkpoint-mongodb on PyPI](https://pypi.org/project/langgraph-checkpoint-mongodb/)
- Related: [mongodb-checkpointer-integration.md](./mongodb-checkpointer-integration.md)
- Related: [langgraph-persistence-for-runtime-restart.md](./langgraph-persistence-for-runtime-restart.md)
