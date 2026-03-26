# Data Model: Single-Node Persistent Memory Store

**Feature**: 098-single-node-memstore
**Date**: 2026-03-25

## Entities

### Checkpoint (existing — no changes)

Serialized conversation state persisted per thread ID.

| Field | Description |
|-------|-------------|
| thread_id | Unique conversation identifier |
| checkpoint_id | Version/timestamp within thread |
| channel_values | Serialized graph state (messages, tool calls, agent state) |
| metadata | Checkpoint metadata (source, step count) |
| pending_writes | Buffered writes not yet committed |

**Storage**: Configured via `LANGGRAPH_CHECKPOINT_TYPE` (memory, redis, postgres, mongodb).

### Store Item (existing — no changes)

Cross-thread key-value entry namespaced by user and category.

| Field | Description |
|-------|-------------|
| namespace | Tuple of (category, user_id) — e.g., ("memories", "user@example.com") |
| key | UUID for individual items |
| value | JSON-safe dict with item payload |
| created_at | Timestamp of initial creation |
| updated_at | Timestamp of last modification |

**Namespaces used**:
- `("memories", "<user_email>")` — Extracted facts and preferences
- `("summaries", "<user_email>")` — Conversation compression summaries

**Storage**: Configured via `LANGGRAPH_STORE_TYPE` (memory, redis, postgres, mongodb).

### Fact (logical — stored as Store Item)

Extracted information from conversations, persisted as Store Items in the "memories" namespace.

| Field | Description |
|-------|-------------|
| data | The extracted fact text (e.g., "User works on team platform-sre") |
| source_thread | Thread ID where the fact was extracted from |
| timestamp | When the fact was extracted |

## Relationships

```
User (email) ──1:N──> Checkpoint (via thread_id in config)
User (email) ──1:N──> Store Item (via namespace scoping)
Store Item ──N:1──> Namespace (category + user_email)
Thread ──1:N──> Checkpoint (versions within a thread)
```

## State Transitions

### Checkpoint Lifecycle
```
(pod start) → InMemory or Persistent backend selected
(first async op) → Lazy connection established
(graph.ainvoke) → Checkpoint written per step
(pod restart) → Persistent: state restored | InMemory: state lost
```

### Fact Extraction Lifecycle
```
(response complete) → Background task created
(task runs) → langmem extracts facts from messages
(facts found) → store.aput() persists to namespace
(new thread) → store_get_cross_thread_context() retrieves facts
```
