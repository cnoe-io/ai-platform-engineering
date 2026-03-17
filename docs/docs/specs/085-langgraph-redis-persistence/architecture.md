---
sidebar_position: 1
id: 085-langgraph-redis-persistence-architecture
sidebar_label: Architecture
---

# Architecture: LangGraph Persistence Backends (Redis, Postgres, MongoDB)

## Decision

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **Pluggable factory with lazy wrappers (chosen)** | Supports all backends via env var, zero-config default, graceful fallback | More wrapper code | Selected |
| Direct backend instantiation | Simpler code | Forces async in synchronous graph builder, no fallback | Rejected |
| Single backend (Redis only) | Simpler configuration | No flexibility for teams with Postgres/MongoDB | Rejected |

## Solution Architecture

### Checkpointer Factory

The checkpointer factory in `checkpointer.py` mirrors the store factory pattern:

```
LANGGRAPH_CHECKPOINT_TYPE ──▶ create_checkpointer()
  │
  ├── memory   ──▶ InMemorySaver (default, state lost on restart)
  ├── redis    ──▶ _LazyAsyncRedisSaver (wraps AsyncRedisSaver)
  ├── postgres ──▶ _LazyAsyncPostgresSaver (wraps AsyncPostgresSaver)
  └── mongodb  ──▶ _LazyAsyncMongoDBSaver (wraps MongoDBSaver)
```

### Lazy Async Initialization Pattern

All external checkpointers inherit from `BaseCheckpointSaver` and use a lazy initialization pattern:

```python
class _LazyAsyncRedisSaver(BaseCheckpointSaver):
    async def _ensure_initialized(self):
        if not self._initialized:
            self._saver_ctx = AsyncRedisSaver.from_conn_string(url, ttl=ttl_config)
            self._saver = await self._saver_ctx.__aenter__()
            await self._saver.setup()
            self._initialized = True

    async def aget_tuple(self, config):
        await self._ensure_initialized()
        return await self._saver.aget_tuple(config)
```

This pattern is necessary because `create_checkpointer()` is called from the synchronous `_build_graph()` method, but the actual database connection requires an async context. The context manager reference is kept to prevent garbage collection from closing the connection.

### TTL Support

Redis checkpointer supports TTL-based expiry via `LANGGRAPH_CHECKPOINT_TTL_MINUTES`:

```python
ttl_config = {
    "default_ttl": ttl_minutes,
    "refresh_on_read": True,  # extends TTL on access
}
```

### Wiring into Agent System

```
deep_agent.py
  ├── create_checkpointer() ──▶ supervisor graph
  └── create_store()         ──▶ supervisor graph
        │
        └── async_create_deep_agent(checkpointer=..., store=...)

base_langgraph_agent.py
  └── get_checkpointer() ──▶ sub-agent graphs (singleton)
```

The global singleton `get_checkpointer()` ensures all sub-agents share a single checkpointer instance, while the supervisor creates its own via `create_checkpointer()`.

### Store Backends (Complementary)

The store factory (`store.py`) provides the same backend options for cross-thread memory:

| Layer | Purpose | Scope | Factory |
|---|---|---|---|
| Checkpointer | In-thread conversation state | `thread_id` | `create_checkpointer()` |
| Store | Cross-thread user memory | `user_id` | `create_store()` |

Both layers fall back gracefully to in-memory defaults on connection failure.

### Helm Chart Integration

The `langgraph-redis` Helm subchart deploys Redis 8.0 (Alpine) with:

- `checkpointPersistence` values: type (memory/redis/postgres/mongodb), connection secrets
- `memoryPersistence` values: type (memory/redis/postgres/mongodb), connection secrets
- Environment variables injected into supervisor-agent and agent deployment templates
- Support for `existingSecret` references (recommended) or inline connection strings

### Graceful Fallback Chain

```
create_checkpointer() / create_store()
  │
  ├── Configured backend available? ──▶ Use it
  ├── Package not installed? ──▶ Log warning, fall back to InMemory
  ├── Connection string missing? ──▶ Log warning, fall back to InMemory
  └── Connection fails at runtime? ──▶ Log error, fall back to InMemory
```

## Components Changed

| File | Description |
|---|---|
| `ai_platform_engineering/utils/checkpointer.py` | Checkpointer factory with InMemorySaver, Redis, Postgres, MongoDB backends; lazy async wrappers; TTL support; global singleton |
| `ai_platform_engineering/utils/store.py` | Store factory with Redis, Postgres, MongoDB backends (updated from stub to real implementations) |
| `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` | Uses `create_checkpointer()` and `create_store()` instead of direct `InMemorySaver()` |
| `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py` | Uses `get_checkpointer()` singleton for sub-agent graphs |
| `charts/ai-platform-engineering/charts/langgraph-redis/` | New Helm subchart for Redis 8.0 deployment |
| `charts/ai-platform-engineering/values.yaml` | `checkpointPersistence` and `memoryPersistence` configuration blocks |

## Related

- Spec: [spec.md](./spec.md)
- ADR: [LangGraph Redis Checkpoint Persistence](../082-langgraph-redis-checkpoint-persistence/architecture.md)
- ADR: [Cross-Thread LangGraph Store](../074-cross-thread-langgraph-store/architecture.md)
