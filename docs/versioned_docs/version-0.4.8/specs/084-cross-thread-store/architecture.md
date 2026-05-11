---
sidebar_position: 1
id: 084-cross-thread-store-architecture
sidebar_label: Architecture
---

# Architecture: Cross-Thread Store & Automatic Fact Extraction

## Decision

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **LangGraph Store with LangMem extraction (chosen)** | Native LangGraph API, pluggable backends, LangMem handles extraction logic | Requires store + LLM for extraction | Selected |
| Custom key-value persistence | Full control, simpler data model | No LangGraph integration, manual wiring | Rejected |
| Thread-spanning checkpointer | Reuses existing checkpointer | Violates thread isolation, data leakage risk | Rejected |
| Manual "remember this" commands only | User control over what is stored | Requires explicit user action, no automatic learning | Deferred |

## Solution Architecture

### Store Factory Pattern

The store factory in `store.py` creates backend-specific store instances based on `LANGGRAPH_STORE_TYPE`:

```
LANGGRAPH_STORE_TYPE ──▶ create_store()
  │
  ├── memory  ──▶ InMemoryStore (default)
  ├── redis   ──▶ _LazyAsyncRedisStore (wraps AsyncRedisStore)
  ├── postgres ──▶ _LazyAsyncPostgresStore (wraps AsyncPostgresStore)
  └── mongodb  ──▶ _LazyAsyncMongoDBStore (custom motor-based wrapper)
```

All external backends use a **lazy async initialization** pattern: the store is created synchronously, but the actual connection is deferred until the first async operation via `_ensure_initialized()`. This allows the synchronous graph builder to accept the store without blocking.

### Namespace Layout

Store data is organized into user-scoped namespaces:

```
Namespace: ("memories", <sanitized_user_id>)
  └── key: uuid
      └── value: {"data": "...", "source_thread": "...", "timestamp": ...}

Namespace: ("summaries", <sanitized_user_id>)
  └── key: uuid
      └── value: {"summary": "...", "thread_id": "...", "timestamp": ...}
```

User IDs containing periods (e.g., email addresses) are sanitized via `sanitize_namespace_label()` which replaces `.` with `_`, since LangGraph namespace labels forbid periods.

An optional `LANGGRAPH_STORE_KEY_PREFIX` allows multiple deployments to share a single Redis instance without key collisions.

### Cross-Thread Context Retrieval

When a new thread starts, `store_get_cross_thread_context()` retrieves prior context:

```
New thread ──▶ store_get_cross_thread_context(store, user_id)
  │
  ├── asearch("summaries", user_id) ──▶ sorted by timestamp desc
  │   └── formatted as "[Previous Conversation Summaries]\n..."
  │
  └── asearch("memories", user_id) ──▶ sorted by timestamp desc
      └── formatted as "[User Memories]\n- fact1\n- fact2\n..."
  │
  └── combined ──▶ injected into system prompt
```

Limits are configurable via `LANGGRAPH_STORE_MAX_SUMMARIES` (default 10) and `LANGGRAPH_STORE_MAX_MEMORIES` (default 50).

### Automatic Fact Extraction

When `ENABLE_FACT_EXTRACTION=true`, the system automatically extracts facts after each agent response:

```
Agent response complete
  │
  └── asyncio.create_task(extract_and_store_facts(...))
        │
        ├── create_fact_extractor(store) ──▶ cached MemoryStoreManager
        │     └── LangMem create_memory_store_manager()
        │         ├── model: FACT_EXTRACTION_MODEL or default LLM
        │         ├── instructions: platform engineering extraction priorities
        │         ├── namespace: ("memories", "{langgraph_user_id}")
        │         ├── enable_inserts: true
        │         └── enable_deletes: false
        │
        └── extractor.ainvoke({"messages": messages}, config=config)
              └── extracted facts persisted to store
```

The extraction runs as a **background asyncio task** with zero impact on response latency. Failures are logged but never propagated.

### Embedding Configuration

The store supports optional semantic search via embeddings, sharing configuration with the RAG stack:

- `EMBEDDINGS_PROVIDER` / `EMBEDDINGS_MODEL` (shared with RAG)
- `LANGGRAPH_STORE_EMBEDDINGS_PROVIDER` / `LANGGRAPH_STORE_EMBEDDINGS_MODEL` (store-specific overrides)
- Auto-detected dimensions for known models (text-embedding-3-small: 1536, text-embedding-3-large: 3072)

Note: MongoDB store does not support semantic/vector search. Use Redis or Postgres for full semantic memory.

## Components Changed

| File | Description |
|---|---|
| `ai_platform_engineering/utils/store.py` | Store factory with InMemoryStore, Redis, Postgres, MongoDB backends; namespace helpers; CRUD operations; cross-thread context retrieval; global singleton |
| `ai_platform_engineering/utils/agent_memory/fact_extraction.py` | LangMem integration for automatic fact extraction; cached MemoryStoreManager; background async extraction |
| `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` | Triggers background fact extraction after response; saves summaries to store during compression |
| `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` | Creates store via factory; passes to graph builder |

## Related

- Spec: [spec.md](./spec.md)
- ADR: [Cross-Thread LangGraph Store](../074-cross-thread-langgraph-store/architecture.md)
- ADR: [Automatic Fact Extraction](../073-automatic-fact-extraction/architecture.md)
