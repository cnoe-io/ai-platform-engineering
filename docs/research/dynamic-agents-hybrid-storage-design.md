# Dynamic Agents Hybrid Storage Architecture Design

**Date:** 2026-03-16  
**Status:** Draft  
**Related:** [ui-chat-storage-vs-langgraph-checkpointer.md](./ui-chat-storage-vs-langgraph-checkpointer.md), [mongodb-checkpointer-integration.md](./mongodb-checkpointer-integration.md)

## Overview

This document describes a hybrid storage architecture for Dynamic Agents where:
- **MongoDB `conversations` collection** stores conversation metadata (for listing, filtering, sharing)
- **LangGraph MongoDBSaver** stores message history (as the source of truth)
- **New UI component** (`ChatPanelDynamicAgents.tsx`) fetches messages from a backend API that probes LangGraph state

## Goals

1. **Persistent conversation history** - Survive pod restarts, runtime cache eviction
2. **Reuse existing UI patterns** - Conversation listing, sharing, archiving work as-is
3. **Single source of truth for messages** - LangGraph checkpointer, not MongoDB messages collection
4. **Clean separation** - Dynamic Agents don't write to the `messages` collection

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UI Layer                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────────┐ │
│  │  Conversation List          │    │  ChatPanelDynamicAgents.tsx         │ │
│  │  (existing component)       │    │  (NEW - fetches from backend API)   │ │
│  │                             │    │                                     │ │
│  │  - Lists from MongoDB       │    │  - On load: GET /threads/{id}/state │ │
│  │  - Filters by agent_id      │    │  - On message: POST /chat/stream    │ │
│  │  - Supports sharing/archive │    │  - Transforms LangChain → ChatMsg   │ │
│  └─────────────────────────────┘    └─────────────────────────────────────┘ │
│              │                                    │                         │
│              │ GET /api/chat/conversations        │ GET /api/dynamic-agents │
│              │ (existing, no changes)             │    /threads/{id}/state  │
│              ▼                                    ▼                         │
└─────────────────────────────────────────────────────────────────────────────┘
                              │                     │
                              │                     │
                              ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Backend Layer                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Dynamic Agents Service                             │  │
│  │                                                                       │  │
│  │  routes/chat.py                    routes/threads.py (NEW)            │  │
│  │  ├─ POST /chat/start-stream        ├─ GET /threads/{id}/state         │  │
│  │  ├─ POST /chat/resume-stream       │   → graph.aget_state()           │  │
│  │  └─ POST /chat/invoke              │   → Transform messages           │  │
│  │                                    │   → Return ChatMessage[]         │  │
│  │  services/agent_runtime.py         └──────────────────────────────────│  │
│  │  ├─ Uses MongoDBSaver (NOT InMemorySaver)                             │  │
│  │  └─ Creates conversation metadata on first message                    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                              │                     │
                              │                     │
                              ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MongoDB Layer                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────────┐ │
│  │  conversations collection   │    │  checkpoints collection             │ │
│  │  (metadata only)            │    │  (LangGraph MongoDBSaver)           │ │
│  │                             │    │                                     │ │
│  │  {                          │    │  {                                  │ │
│  │    _id: "conv-123",         │    │    thread_id: "conv-123",           │ │
│  │    title: "Debug issue",    │    │    checkpoint_ns: "",               │ │
│  │    owner_id: "user@...",    │    │    checkpoint_id: "...",            │ │
│  │    agent_id: "agent-456",   │    │    channel_values: {                │ │
│  │    created_at: Date,        │    │      messages: [                    │ │
│  │    sharing: {...},          │    │        HumanMessage(...),           │ │
│  │    is_archived: false       │    │        AIMessage(...),              │ │
│  │  }                          │    │        ToolMessage(...)             │ │
│  │                             │    │      ]                              │ │
│  │  NO messages field          │    │    }                                │ │
│  └─────────────────────────────┘    │  }                                  │ │
│                                     └─────────────────────────────────────┘ │
│                                                                             │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────────┐ │
│  │  messages collection        │    │  checkpoint_writes collection       │ │
│  │  (Platform Engineer only)   │    │  (LangGraph intermediate writes)    │ │
│  └─────────────────────────────┘    └─────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Design

### 1. Backend: MongoDBSaver Integration

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`

Replace `InMemorySaver` with a shared `MongoDBSaver`:

```python
# Current (line 87)
self._checkpointer = InMemorySaver()

# Proposed
from ai_platform_engineering.utils.checkpointer import get_checkpointer

# In AgentRuntime.__init__():
self._checkpointer = get_checkpointer()  # Returns MongoDBSaver based on config
```

**Configuration:**

```bash
# .env or environment
LANGGRAPH_CHECKPOINT_TYPE=mongodb
LANGGRAPH_CHECKPOINT_MONGODB_URI=mongodb://localhost:27017
```

**Note:** The existing `ai_platform_engineering/utils/checkpointer.py` already supports MongoDB via `_LazyAsyncMongoDBSaver`. We can reuse this.

### 2. Backend: New Thread State Endpoint

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/threads.py` (NEW)

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage

router = APIRouter(prefix="/threads", tags=["threads"])


class UIMessage(BaseModel):
    """Message format compatible with UI ChatMessage interface."""
    id: str
    role: str  # "user" | "assistant" | "system"
    content: str
    timestamp: datetime
    tool_calls: Optional[list[dict]] = None
    tool_call_id: Optional[str] = None
    is_tool_result: bool = False


class ThreadStateResponse(BaseModel):
    """Response containing conversation history from LangGraph state."""
    thread_id: str
    messages: list[UIMessage]
    has_pending_interrupt: bool = False
    interrupt_data: Optional[dict] = None


def _transform_langchain_message(msg) -> UIMessage:
    """Transform a LangChain message to UI-compatible format."""
    # Determine role
    if isinstance(msg, HumanMessage):
        role = "user"
    elif isinstance(msg, AIMessage):
        role = "assistant"
    elif isinstance(msg, ToolMessage):
        role = "assistant"  # Tool results shown as assistant messages
    elif isinstance(msg, SystemMessage):
        role = "system"
    else:
        role = "assistant"
    
    # Extract timestamp from additional_kwargs if available
    timestamp = msg.additional_kwargs.get("timestamp")
    if timestamp:
        timestamp = datetime.fromisoformat(timestamp)
    else:
        timestamp = datetime.utcnow()
    
    # Handle tool calls
    tool_calls = None
    if hasattr(msg, "tool_calls") and msg.tool_calls:
        tool_calls = [
            {"id": tc.get("id"), "name": tc.get("name"), "args": tc.get("args")}
            for tc in msg.tool_calls
        ]
    
    return UIMessage(
        id=msg.id or str(uuid.uuid4()),
        role=role,
        content=msg.content if isinstance(msg.content, str) else str(msg.content),
        timestamp=timestamp,
        tool_calls=tool_calls,
        tool_call_id=getattr(msg, "tool_call_id", None),
        is_tool_result=isinstance(msg, ToolMessage),
    )


@router.get("/{thread_id}/state", response_model=ThreadStateResponse)
async def get_thread_state(
    thread_id: str,
    agent_id: str,  # Query param to identify which agent's runtime to use
    user_id: str = Depends(get_current_user_id),
):
    """
    Retrieve conversation history from LangGraph checkpointer.
    
    This endpoint probes the LangGraph state for a given thread_id
    and transforms the messages into UI-compatible format.
    """
    # Get or create runtime for this agent/thread
    cache = get_runtime_cache()
    runtime = await cache.get_or_create(
        agent_id=agent_id,
        session_id=thread_id,
        user_email=user_id,
        # ... other params
    )
    
    if not runtime or not runtime._graph:
        raise HTTPException(status_code=404, detail="Runtime not found")
    
    # Get state from LangGraph
    config = {"configurable": {"thread_id": thread_id}}
    state = await runtime._graph.aget_state(config)
    
    if not state or not state.values:
        return ThreadStateResponse(
            thread_id=thread_id,
            messages=[],
            has_pending_interrupt=False,
        )
    
    # Transform messages
    raw_messages = state.values.get("messages", [])
    ui_messages = [_transform_langchain_message(msg) for msg in raw_messages]
    
    # Check for pending interrupts
    has_interrupt = bool(state.interrupts) if hasattr(state, "interrupts") else False
    interrupt_data = None
    if has_interrupt and state.interrupts:
        interrupt_data = {
            "type": "user_input_required",
            "value": getattr(state.interrupts[0], "value", None),
        }
    
    return ThreadStateResponse(
        thread_id=thread_id,
        messages=ui_messages,
        has_pending_interrupt=has_interrupt,
        interrupt_data=interrupt_data,
    )
```

### 3. Backend: Conversation Metadata Sync

When a new conversation starts, create a metadata record in MongoDB:

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py`

```python
async def _ensure_conversation_exists(
    conversation_id: str,
    agent_id: str,
    owner_id: str,
    title: Optional[str] = None,
):
    """
    Create conversation metadata in MongoDB if it doesn't exist.
    This enables the conversation to appear in the UI's conversation list.
    """
    db = get_mongodb_client()
    conversations = db["conversations"]
    
    existing = await conversations.find_one({"_id": conversation_id})
    if existing:
        # Update last activity
        await conversations.update_one(
            {"_id": conversation_id},
            {"$set": {"updated_at": datetime.utcnow()}}
        )
        return
    
    # Create new conversation metadata
    await conversations.insert_one({
        "_id": conversation_id,
        "title": title or "New Conversation",
        "owner_id": owner_id,
        "agent_id": agent_id,  # Links to Dynamic Agent
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "metadata": {
            "agent_version": "1.0",
            "model_used": "unknown",  # Can be updated after first response
            "total_messages": 0,      # Not maintained (messages in checkpointer)
        },
        "sharing": {
            "is_public": False,
            "shared_with": [],
            "shared_with_teams": [],
            "share_link_enabled": False,
        },
        "tags": [],
        "is_archived": False,
        "is_pinned": False,
    })


# In _generate_sse_events():
async def _generate_sse_events(
    agent_config: DynamicAgentConfig,
    mcp_servers: list,
    message: str,
    session_id: str,
    user_id: str,
    ...
) -> AsyncGenerator[str, None]:
    # Ensure conversation exists in MongoDB for listing
    await _ensure_conversation_exists(
        conversation_id=session_id,
        agent_id=agent_config.id,
        owner_id=user_id,
        title=f"Chat with {agent_config.name}",
    )
    
    # ... rest of streaming logic
```

### 4. UI: ChatPanelDynamicAgents Component

**File:** `ui/src/components/chat/ChatPanelDynamicAgents.tsx` (NEW)

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { useChatStore } from "@/store/chat-store";
import { ChatMessage } from "@/types/a2a";

interface Props {
  conversationId: string;
  agentId: string;
}

export function ChatPanelDynamicAgents({ conversationId, agentId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch conversation history from LangGraph state
  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/dynamic-agents/threads/${conversationId}/state?agent_id=${agentId}`
      );
      
      if (!response.ok) {
        throw new Error("Failed to load conversation history");
      }
      
      const data = await response.json();
      
      // Transform backend messages to ChatMessage format
      const chatMessages: ChatMessage[] = data.messages.map((msg: any) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        content: msg.content,
        timestamp: new Date(msg.timestamp),
        events: [],
        isFinal: true,
      }));
      
      setMessages(chatMessages);
      
      // Handle pending interrupt if any
      if (data.has_pending_interrupt && data.interrupt_data) {
        // Show HITL UI
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [conversationId, agentId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ... rest of component (message rendering, input handling, streaming)
  // The streaming logic can reuse existing DynamicAgentClient
}
```

### 5. UI: API Route Proxy

**File:** `ui/src/app/api/dynamic-agents/threads/[id]/state/route.ts` (NEW)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const DYNAMIC_AGENTS_URL = process.env.DYNAMIC_AGENTS_URL || "http://localhost:8001";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");
  
  if (!agentId) {
    return NextResponse.json({ error: "agent_id required" }, { status: 400 });
  }

  const response = await fetch(
    `${DYNAMIC_AGENTS_URL}/api/v1/threads/${params.id}/state?agent_id=${agentId}`,
    {
      headers: {
        "X-User-Email": session.user.email,
        "X-User-Name": session.user.name || "",
      },
    }
  );

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
```

## Data Flow

### Loading Conversation History

```
1. User clicks on conversation in sidebar
   │
2. UI detects agent_id is set → uses ChatPanelDynamicAgents
   │
3. Component calls GET /api/dynamic-agents/threads/{id}/state
   │
4. Next.js API route proxies to Dynamic Agents backend
   │
5. Backend gets runtime from cache (or creates new one)
   │
6. Backend calls graph.aget_state({"configurable": {"thread_id": id}})
   │
7. MongoDBSaver retrieves checkpoint from MongoDB
   │
8. Backend transforms LangChain messages → UI format
   │
9. Response flows back to UI
   │
10. ChatPanelDynamicAgents renders messages
```

### Sending New Message

```
1. User types message, clicks send
   │
2. Component calls POST /api/dynamic-agents/chat/start-stream
   │
3. Backend calls _ensure_conversation_exists() (creates/updates metadata)
   │
4. Backend streams via runtime.stream()
   │
5. LangGraph appends messages to state
   │
6. MongoDBSaver persists checkpoint to MongoDB
   │
7. SSE events stream back to UI
   │
8. Component updates local state with streamed content
```

## Database Schema Changes

### conversations Collection (Extended)

No schema changes needed. The existing schema supports this via:
- `agent_id: string` - Already optional, used to identify Dynamic Agent conversations
- `metadata.total_messages: number` - Can be 0 or ignored for Dynamic Agent convos

### New Collections (from MongoDBSaver)

| Collection | Created By | Purpose |
|------------|------------|---------|
| `checkpoints` | MongoDBSaver | Stores checkpoint state including messages |
| `checkpoint_writes` | MongoDBSaver | Stores intermediate writes for crash recovery |

## Migration / Rollout Plan

### Phase 1: Backend Changes
1. Configure `LANGGRAPH_CHECKPOINT_TYPE=mongodb` in Dynamic Agents
2. Replace `InMemorySaver` with `get_checkpointer()` in `agent_runtime.py`
3. Add `_ensure_conversation_exists()` to chat routes
4. Add new `/threads/{id}/state` endpoint

### Phase 2: UI Changes
1. Create `ChatPanelDynamicAgents.tsx` component
2. Create API route proxy `/api/dynamic-agents/threads/[id]/state`
3. Update `ChatPanel.tsx` to conditionally render based on `agent_id`

### Phase 3: Testing & Validation
1. Test conversation persistence across pod restarts
2. Test conversation listing shows Dynamic Agent conversations
3. Test sharing/archiving works for Dynamic Agent conversations
4. Test HITL flow with persistent state

## Open Questions

1. **Title Generation:** How should conversation titles be generated for Dynamic Agents?
   - Option A: Use first user message (truncated)
   - Option B: Call LLM to generate title after first exchange
   - Option C: Default to "Chat with {agent_name}" + allow user rename

2. **Message Metadata:** Should we store additional metadata in `additional_kwargs`?
   - `timestamp`, `sender_email`, `sender_name` for shared conversations
   - `turn_id` for grouping user/assistant message pairs

3. **Conversation Deletion:** When user deletes conversation:
   - Option A: Soft-delete in `conversations`, leave checkpoints (auto-expire via TTL)
   - Option B: Hard-delete both conversation metadata and checkpoints
   - Option C: Soft-delete metadata, hard-delete checkpoints after grace period

4. **Runtime Cache Strategy:** With MongoDBSaver, runtime cache is less critical for state:
   - Should we reduce TTL since state is persisted?
   - Should we add a "warm-up" step to pre-fetch tools on first access?

## Security Considerations

1. **Conversation Access Control:** The `/threads/{id}/state` endpoint must verify:
   - User is owner OR conversation is shared with user
   - Agent is accessible to user

2. **Checkpoint Isolation:** MongoDBSaver stores all agents' checkpoints in same collection:
   - `thread_id` includes conversation ID which is checked against ownership
   - No cross-tenant data leakage possible if conversation access is enforced

## Performance Considerations

1. **Checkpoint Size:** Large conversations may have large checkpoints:
   - Consider implementing message trimming (already exists in `base_langgraph_agent.py`)
   - Consider TTL on checkpoints collection

2. **Cold Start:** First access to a conversation requires:
   - Runtime initialization (MCP connections, subagent resolution)
   - Checkpoint fetch from MongoDB
   - Consider background warming for recently accessed conversations

## Appendix: Key Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` | Modify | Use `get_checkpointer()` instead of `InMemorySaver` |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py` | Modify | Add `_ensure_conversation_exists()` |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/threads.py` | Create | New endpoint for fetching thread state |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/main.py` | Modify | Register new threads router |
| `ui/src/components/chat/ChatPanelDynamicAgents.tsx` | Create | New component for Dynamic Agents chat |
| `ui/src/app/api/dynamic-agents/threads/[id]/state/route.ts` | Create | API proxy for thread state |
| `ui/src/components/chat/ChatPanel.tsx` | Modify | Conditionally render based on agent_id |
