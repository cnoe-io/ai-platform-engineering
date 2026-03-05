# Spec: LangGraph Redis Persistence

## Overview

Enable Redis persistence for both the LangGraph checkpointer (in-thread conversation state) and cross-thread memory store using `langgraph-checkpoint-redis`, backed by a dedicated Redis Stack instance with RedisJSON and RediSearch modules.

## Motivation

Currently, both persistence layers default to in-memory backends:
- **Checkpointer** (`InMemorySaver`): Conversation state is lost on pod restart, causing multi-turn conversations to break.
- **Store** (`InMemoryStore` stub): Cross-thread memory is never persisted to Redis despite `LANGGRAPH_STORE_TYPE=redis` being configurable.

Deploying Redis Stack resolves both issues, enabling durable conversation state and true cross-thread memory persistence.

## Scope

### In Scope
- Add `langgraph-checkpoint-redis` Python dependency
- Implement checkpointer factory (`checkpointer.py`) with `InMemorySaver`/`RedisSaver` backends
- Replace Redis store stub with real `AsyncRedisStore` via lazy wrapper
- Wire both into supervisor (`deep_agent.py`) and sub-agents (`base_langgraph_agent.py`)
- Create `langgraph-redis` Helm subchart with Redis Stack image
- Add `checkpointPersistence` Helm values and env var injection to supervisor-agent and agent templates
- Unit tests for factory and store
- Spec and ADR documentation

### Out of Scope
- Postgres checkpointer backend
- Data migration from in-memory to Redis
- UI changes
- Authentication/TLS for Redis (handled at deployment level)

## Design

### Architecture

```
┌─────────────────┐     ┌──────────────────────────────┐
│  supervisor-agent│────▶│  langgraph-redis (Redis Stack)│
│  (deep_agent.py) │     │  ┌────────────────────────┐  │
│                  │     │  │ RedisSaver (checkpoints)│  │
│  create_         │     │  │ DB 0                    │  │
│  checkpointer()  │     │  ├────────────────────────┤  │
│  create_store()  │     │  │ AsyncRedisStore (store) │  │
│                  │     │  │ DB 0                    │  │
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

### Components Affected
- [x] Multi-Agents (`ai_platform_engineering/multi_agents/`)
- [x] Utils (`ai_platform_engineering/utils/`)
- [x] Helm Charts (`charts/`)
- [x] Documentation (`docs/`)

## Acceptance Criteria

- [x] `create_checkpointer()` returns `RedisSaver` when configured, `InMemorySaver` otherwise
- [x] `_create_redis_store()` returns `_LazyAsyncRedisStore` (not stub `InMemoryStore`) when `langgraph-checkpoint-redis` is installed
- [x] `deep_agent.py` uses `create_checkpointer()` instead of `InMemorySaver()`
- [x] `base_langgraph_agent.py` uses `get_checkpointer()` instead of `MemorySaver()`
- [x] `langgraph-redis` Helm subchart deploys Redis Stack (`redis/redis-stack-server:7.2.0-v13`)
- [x] `checkpointPersistence` values and env vars available in supervisor-agent and agent charts
- [x] All new and existing unit tests pass
- [x] Documentation (spec + ADR) created

## Implementation Plan

### Phase 1: Dependency
- [x] Add `langgraph-checkpoint-redis>=0.3.5` to `pyproject.toml`

### Phase 2: Checkpointer Factory
- [x] Create `ai_platform_engineering/utils/checkpointer.py`

### Phase 3: Redis Store
- [x] Replace `_create_redis_store()` stub with `_LazyAsyncRedisStore`

### Phase 4: Wire into Agents
- [x] Update `deep_agent.py` and `base_langgraph_agent.py`

### Phase 5: Helm Subchart
- [x] Create `charts/ai-platform-engineering/charts/langgraph-redis/`

### Phase 6: Helm Values & Templates
- [x] Add `checkpointPersistence` to supervisor-agent and agent charts

### Phase 7: Tests
- [x] `tests/test_checkpointer.py` (16 tests)
- [x] `tests/test_redis_store.py` (12 tests)

### Phase 8: Documentation
- [x] Spec and ADR

## Testing Strategy

- Unit tests: Checkpointer factory (memory/redis/fallback), Redis store wrapper (lazy init, delegation, sync rejection)
- Existing tests: All 97 store tests verified passing
- Manual verification: Deploy with `checkpointPersistence.type=redis` and `memoryPersistence.type=redis` pointing at langgraph-redis

## Rollout Plan

1. Merge PR and tag release
2. Enable in preview: set `global.langgraphRedis.enabled=true`, configure `checkpointPersistence.type=redis` and `memoryPersistence.type=redis` pointing at `langgraph-redis` service
3. Verify conversation persistence across pod restarts
4. Enable in production after validation

## Related

- ADR: `docs/docs/changes/2026-03-04-langgraph-redis-checkpoint-persistence.md`
- ADR: `docs/docs/changes/2026-02-26-cross-thread-langgraph-store.md`
- PR: #861 (cross-thread memory store)
