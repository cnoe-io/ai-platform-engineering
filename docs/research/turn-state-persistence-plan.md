# Turn State Persistence Plan

**Status:** Draft  
**Created:** 2026-03-23  
**Author:** AI Assistant  

## Overview

Store per-turn state (files, todos) in the MongoDB `messages` collection alongside message content. This enables historical tracking of conversation state progression without duplicating the checkpointer as source of truth for live state.

## Goals

1. Store file paths and todo state as a snapshot per assistant message
2. Enable historical view of how files/todos evolved across turns
3. Keep implementation simple - extend existing `messages` collection
4. Maintain checkpointer as source of truth for live/resumable state

## Current Architecture

### Storage Systems

| System | What | Used For |
|--------|------|----------|
| **MongoDB `messages`** | User/assistant messages, A2A events | Chat history display |
| **LangGraph Checkpointer** | Full agent state (messages, files, todos, interrupts) | Live state, HITL, resume |

### Current Message Schema

```typescript
interface Message {
  message_id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: {
    turn_id: string;
    is_final: boolean;
    timeline_segments?: any[];
  };
  a2a_events?: any[];
  artifacts?: Artifact[];
  created_at: Date;
  updated_at: Date;
}
```

### Current Data Flow

```
DynamicAgentContext fetches files/todos from checkpointer API
                    ↓
        Displayed in UI (local component state)
                    ↓
        Streaming completes
                    ↓
        saveMessagesToServer() writes messages to MongoDB
        (files/todos NOT included - lost)
```

## Proposed Design

### Extended Message Schema

```typescript
interface Message {
  // ... existing fields ...
  
  // NEW: Turn state snapshot (for DA conversations)
  turn_state?: {
    files?: string[];  // File paths at this turn (not content)
    todos?: Array<{
      content: string;
      status: 'pending' | 'in_progress' | 'completed';
    }>;
  };
}
```

### New Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DURING SESSION                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  DynamicAgentContext                                                 │
│       │                                                              │
│       │ fetches files/todos from checkpointer API                   │
│       │                                                              │
│       ▼                                                              │
│  setConversationFiles(convId, files)  ──►  Zustand Store            │
│  setConversationTodos(convId, todos)       (ephemeral, in-memory)   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ streaming completes
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SAVE TO MONGODB                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  setConversationStreaming(convId, null)                             │
│       │                                                              │
│       ▼                                                              │
│  saveMessagesToServer(convId)                                       │
│       │                                                              │
│       │ reads conv.daFiles, conv.daTodos from store                 │
│       │                                                              │
│       ▼                                                              │
│  POST /api/chat/conversations/{id}/messages                         │
│       │                                                              │
│       │ includes turn_state: { files: [...], todos: [...] }         │
│       │                                                              │
│       ▼                                                              │
│  MongoDB `messages` collection                                       │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ {                                                          │     │
│  │   message_id: "...",                                       │     │
│  │   role: "assistant",                                       │     │
│  │   content: "...",                                          │     │
│  │   turn_state: {           ◄── NEW: persisted snapshot      │     │
│  │     files: ["/workspace/main.py", "/workspace/utils.py"],  │     │
│  │     todos: [                                               │     │
│  │       { content: "Implement feature X", status: "done" },  │     │
│  │       { content: "Write tests", status: "pending" }        │     │
│  │     ]                                                      │     │
│  │   }                                                        │     │
│  │ }                                                          │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Storage Responsibilities

| Storage | What | Lifetime | Purpose |
|---------|------|----------|---------|
| **Zustand** | `daFiles`, `daTodos` | Session (ephemeral) | UI display, pass to save |
| **MongoDB** | `turn_state` in message | Permanent | Historical snapshot per turn |
| **Checkpointer** | Full state | Permanent | Live state for HITL, resume |

## Implementation Plan

### Phase 1: Extend Types

**File:** `ui/src/types/mongodb.ts`

```typescript
export interface TurnState {
  files?: string[];
  todos?: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

export interface Message {
  // ... existing fields ...
  turn_state?: TurnState;
}
```

### Phase 2: Add Zustand State & Actions

**File:** `ui/src/store/chat-store.ts`

1. Extend `Conversation` interface:
```typescript
interface Conversation {
  // ... existing ...
  daFiles?: string[];  // DA-specific: current file paths
  daTodos?: Array<{ content: string; status: string }>;
}
```

2. Add actions:
```typescript
setConversationFiles: (conversationId: string, files: string[]) => void;
setConversationTodos: (conversationId: string, todos: TodoItem[]) => void;
```

3. Modify `saveMessagesToServer`:
- Read `conv.daFiles` and `conv.daTodos` from store
- Include as `turn_state` in the last assistant message payload

### Phase 3: Update DynamicAgentContext

**File:** `ui/src/components/dynamic-agents/DynamicAgentContext.tsx`

Replace local state with Zustand:

```typescript
// Before
const [files, setFiles] = useState<string[]>([]);
const [todos, setTodos] = useState<TodoItem[]>([]);

// After
const { setConversationFiles, setConversationTodos } = useChatStore();
const files = useChatStore(s => 
  s.conversations.find(c => c.id === conversationId)?.daFiles ?? []
);
const todos = useChatStore(s => 
  s.conversations.find(c => c.id === conversationId)?.daTodos ?? []
);

// When fetching:
setConversationFiles(conversationId, fetchedFiles);
setConversationTodos(conversationId, fetchedTodos);
```

### Phase 4: Update API Route

**File:** `ui/src/app/api/chat/conversations/[id]/messages/route.ts`

Handle `turn_state` field in the upsert:

```typescript
$set: {
  // ... existing fields ...
  ...(body.turn_state && { turn_state: body.turn_state }),
}
```

## File Changes Summary

| File | Change |
|------|--------|
| `ui/src/types/mongodb.ts` | Add `TurnState` interface, extend `Message` |
| `ui/src/store/chat-store.ts` | Add `daFiles`/`daTodos` to Conversation, add actions, modify `saveMessagesToServer` |
| `ui/src/components/dynamic-agents/DynamicAgentContext.tsx` | Use Zustand instead of local state |
| `ui/src/app/api/chat/conversations/[id]/messages/route.ts` | Handle `turn_state` in upsert |

## Benefits

1. **Historical tracking** - See how files/todos evolved per turn
2. **Single storage** - No separate collection for turn snapshots
3. **Backward compatible** - `turn_state` is optional field
4. **Efficient** - Only file paths stored (not content)
5. **Unified with existing save** - Uses existing `saveMessagesToServer` flow

## Trade-offs

1. **Zustand complexity** - More fields in conversation state
2. **Checkpointer still needed** - For live state, HITL, resume
3. **Snapshot timing** - Captured at save time, not real-time

## Future Considerations

1. **File diffs** - Could add `files_created`, `files_modified`, `files_deleted` per turn
2. **Todo diffs** - Could track which todos changed status per turn
3. **File content snapshots** - Could optionally store content for small files
4. **Turn metadata** - Could add execution time, token count, etc.

## Testing Plan

1. **Unit tests** - Store actions for setConversationFiles/Todos
2. **Integration tests** - Save flow includes turn_state
3. **E2E tests** - Create files/todos, verify persisted in MongoDB

## Rollout

1. Deploy schema changes (backward compatible)
2. Deploy UI changes
3. Verify new messages have turn_state
4. Old messages without turn_state continue to work
