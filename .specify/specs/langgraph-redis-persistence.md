# Spec: LangGraph Persistence Backends (Redis, Postgres, MongoDB)

## Overview

Enable pluggable persistence for both the LangGraph checkpointer (in-thread conversation state) and cross-thread memory store supporting Redis Stack, PostgreSQL, and MongoDB backends — all with graceful fallback to in-memory defaults.

## Motivation

Currently, both persistence layers default to in-memory backends:
- **Checkpointer** (`InMemorySaver`): Conversation state is lost on pod restart, causing multi-turn conversations to break.
- **Store** (`InMemoryStore` stub): Cross-thread memory is never persisted to Redis despite `LANGGRAPH_STORE_TYPE=redis` being configurable.

Deploying a persistent backend (Redis Stack, PostgreSQL, or MongoDB) resolves both issues, enabling durable conversation state and true cross-thread memory persistence.

## Scope

### In Scope
- Add `langgraph-checkpoint-redis`, `langgraph-checkpoint-postgres`, `langgraph-checkpoint-mongodb`, and `motor` Python dependencies
- Implement checkpointer factory (`checkpointer.py`) with `InMemorySaver`/`RedisSaver`/`PostgresSaver`/`MongoDBSaver` backends
- Replace Redis store stub with real `AsyncRedisStore` via lazy wrapper
- Add Postgres store via `AsyncPostgresStore` lazy wrapper
- Add MongoDB store via `motor`-based `_LazyAsyncMongoDBStore` custom wrapper
- Wire both into supervisor (`deep_agent.py`) and sub-agents (`base_langgraph_agent.py`)
- Create `langgraph-redis` Helm subchart with Redis Stack image
- Add `checkpointPersistence` Helm values with redis/postgres/mongodb support and env var injection to supervisor-agent and agent templates
- Add `memoryPersistence` mongodb option to Helm values and templates
- Unit tests for factory and store (65 tests)
- Spec and ADR documentation

### Out of Scope
- Data migration between backends
- UI changes
- Authentication/TLS for backends (handled at deployment level)

## Design

### Architecture

```
┌─────────────────┐     ┌──────────────────────────────┐
│  supervisor-agent│────▶│  Backend (configurable)       │
│  (deep_agent.py) │     │  ┌────────────────────────┐  │
│                  │     │  │ Checkpointer            │  │
│  create_         │     │  │ (Redis/Postgres/MongoDB)│  │
│  checkpointer()  │     │  ├────────────────────────┤  │
│  create_store()  │     │  │ Store                   │  │
│                  │     │  │ (Redis/Postgres/MongoDB)│  │
└─────────────────┘     │  └────────────────────────┘  │
                        └──────────────────────────────┘
┌─────────────────┐                │
│  sub-agents      │────────────────┘
│  (base_langgraph │
│   _agent.py)     │
│  get_            │
│  checkpointer()  │
└─────────────────┘
```

### Checkpointer Backends

| Backend | Package | Class | Env Var |
|---|---|---|---|
| Memory (default) | langgraph | `InMemorySaver` | `LANGGRAPH_CHECKPOINT_TYPE=memory` |
| Redis Stack | langgraph-checkpoint-redis | `RedisSaver` | `LANGGRAPH_CHECKPOINT_TYPE=redis` |
| PostgreSQL | langgraph-checkpoint-postgres | `PostgresSaver` | `LANGGRAPH_CHECKPOINT_TYPE=postgres` |
| MongoDB | langgraph-checkpoint-mongodb | `MongoDBSaver` | `LANGGRAPH_CHECKPOINT_TYPE=mongodb` |

### Store Backends

| Backend | Package | Class | Env Var |
|---|---|---|---|
| Memory (default) | langgraph | `InMemoryStore` | `LANGGRAPH_STORE_TYPE=memory` |
| Redis Stack | langgraph-checkpoint-redis | `AsyncRedisStore` (lazy) | `LANGGRAPH_STORE_TYPE=redis` |
| PostgreSQL | langgraph-checkpoint-postgres | `AsyncPostgresStore` (lazy) | `LANGGRAPH_STORE_TYPE=postgres` |
| MongoDB | motor | `_LazyAsyncMongoDBStore` (custom) | `LANGGRAPH_STORE_TYPE=mongodb` |

### Components Affected
- [x] Multi-Agents (`ai_platform_engineering/multi_agents/`)
- [x] Utils (`ai_platform_engineering/utils/`)
- [x] Helm Charts (`charts/`)
- [x] Documentation (`docs/`)

## Acceptance Criteria

- [x] `create_checkpointer()` returns `RedisSaver`, `PostgresSaver`, or `MongoDBSaver` when configured; `InMemorySaver` otherwise
- [x] `_create_redis_store()` returns `_LazyAsyncRedisStore` when `langgraph-checkpoint-redis` is installed
- [x] `_create_postgres_store()` returns `_LazyAsyncPostgresStore` when `langgraph-checkpoint-postgres` is installed
- [x] `_create_mongodb_store()` returns `_LazyAsyncMongoDBStore` when `motor` is installed
- [x] `deep_agent.py` uses `create_checkpointer()` instead of `InMemorySaver()`
- [x] `base_langgraph_agent.py` uses `get_checkpointer()` instead of `MemorySaver()`
- [x] `langgraph-redis` Helm subchart deploys Redis Stack (`redis/redis-stack-server:7.2.0-v13`)
- [x] `checkpointPersistence` values support redis, postgres, and mongodb in supervisor-agent and agent charts
- [x] `memoryPersistence` values support redis, postgres, and mongodb
- [x] All 65 new unit tests pass
- [x] Documentation (spec + ADR) created

## Implementation Plan

### Phase 1: Dependencies
- [x] Add `langgraph-checkpoint-redis>=0.3.5`, `langgraph-checkpoint-postgres>=2.0.0`, `langgraph-checkpoint-mongodb>=0.3.0`, `motor>=3.4.0` to `pyproject.toml`

### Phase 2: Checkpointer Factory
- [x] Create `ai_platform_engineering/utils/checkpointer.py` with memory/redis/postgres/mongodb backends

### Phase 3: Store Backends
- [x] Replace `_create_redis_store()` stub with `_LazyAsyncRedisStore`
- [x] `_LazyAsyncPostgresStore` (already present from prior work)
- [x] Add `_create_mongodb_store()` with `_LazyAsyncMongoDBStore` custom wrapper

### Phase 4: Wire into Agents
- [x] Update `deep_agent.py` and `base_langgraph_agent.py`

### Phase 5: Helm Subchart
- [x] Create `charts/ai-platform-engineering/charts/langgraph-redis/`

### Phase 6: Helm Values & Templates
- [x] Add postgres/mongodb to `checkpointPersistence` in supervisor-agent and agent charts
- [x] Add mongodb to `memoryPersistence` in supervisor-agent chart
- [x] Inject `LANGGRAPH_CHECKPOINT_POSTGRES_DSN`, `LANGGRAPH_CHECKPOINT_MONGODB_URI`, `LANGGRAPH_STORE_MONGODB_URI` env vars in deployment templates

### Phase 7: Tests
- [x] `tests/test_checkpointer.py` (29 tests — config, factory, singleton for all backends)
- [x] `tests/test_redis_store.py` (36 tests — Redis, Postgres, MongoDB store wrappers + factory)

### Phase 8: Documentation
- [x] Spec and ADR

## Testing Strategy

- Unit tests: Checkpointer factory (memory/redis/postgres/mongodb/fallback), Store wrappers (lazy init, delegation, sync rejection) for all three backends
- All 65 tests verified passing
- Manual verification: Deploy with `checkpointPersistence.type=redis|postgres|mongodb` and `memoryPersistence.type=redis|postgres|mongodb`

## Rollout Plan

1. Merge PR and tag release
2. Enable in preview: configure desired backend via `checkpointPersistence.type` and `memoryPersistence.type`
3. For Redis: set `global.langgraphRedis.enabled=true` and point URLs at `langgraph-redis` service
4. For Postgres: provide DSN via `existingSecret` (recommended) or `dsn`
5. For MongoDB: provide URI via `existingSecret` (recommended) or `uri`
6. Verify conversation persistence across pod restarts
7. Enable in production after validation

## Related

- ADR: `docs/docs/changes/2026-03-04-langgraph-redis-checkpoint-persistence.md`
- ADR: `docs/docs/changes/2026-02-26-cross-thread-langgraph-store.md`
- PR: #861 (cross-thread memory store)
