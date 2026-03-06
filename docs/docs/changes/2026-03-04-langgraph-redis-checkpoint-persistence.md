# LangGraph Persistence Backends: Redis, Postgres, MongoDB

**Status**: 🟡 Preview
**Category**: Architecture & Design
**Date**: March 4, 2026

## Overview

Enabled pluggable persistence for both the LangGraph checkpointer (in-thread conversation state) and cross-thread memory store, supporting Redis Stack, PostgreSQL, and MongoDB backends with graceful fallback to in-memory defaults.

## Problem Statement

Both persistence layers defaulted to in-memory backends:
- **Checkpointer** (`InMemorySaver`): Conversation state was lost on pod restart; multi-turn conversations broke across deployments.
- **Store** (`InMemoryStore`): The Redis store factory in `store.py` was a stub that always fell back to `InMemoryStore` despite configuration for Redis, meaning cross-thread memories were never actually persisted.

The existing `rag-redis` instance (Redis 7.2-alpine) cannot serve as the persistence backend because it lacks the RedisJSON and RediSearch modules required by `langgraph-checkpoint-redis`.

## Decision

Deploy a dedicated Redis Stack instance as the primary option, and provide PostgreSQL and MongoDB as additional backend choices for organizations with existing database infrastructure.

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **Redis Stack + factory (primary)** | Correct modules, clean separation, fast | Additional pod | Selected |
| **PostgreSQL backend** | ACID, relational, existing infra | Heavier, more setup | Selected |
| **MongoDB backend** | Document-native, flexible, Atlas/DocumentDB | Custom store wrapper | Selected |
| Upgrade rag-redis to Redis Stack | Reuse existing infra | Risk to RAG indexing | Rejected |
| Keep in-memory | Zero infra | State lost on restart | Rejected |

## Solution Architecture

### Checkpointer Factory (`checkpointer.py`)

```python
# Environment variables:
LANGGRAPH_CHECKPOINT_TYPE=memory    # memory (default) | redis | postgres | mongodb
LANGGRAPH_CHECKPOINT_REDIS_URL=     # Redis Stack connection string
LANGGRAPH_CHECKPOINT_POSTGRES_DSN=  # PostgreSQL DSN
LANGGRAPH_CHECKPOINT_MONGODB_URI=   # MongoDB connection URI
LANGGRAPH_CHECKPOINT_TTL_MINUTES=0  # 0 = no expiry
```

- `create_checkpointer()` returns the appropriate saver based on `LANGGRAPH_CHECKPOINT_TYPE`
- `get_checkpointer()` provides a global singleton
- Graceful fallback: if backend is unreachable or package missing, falls back to `InMemorySaver`

### Store Factory (`store.py`)

```python
# Environment variables:
LANGGRAPH_STORE_TYPE=memory         # memory (default) | redis | postgres | mongodb
LANGGRAPH_STORE_REDIS_URL=          # Redis Stack connection string
LANGGRAPH_STORE_POSTGRES_DSN=       # PostgreSQL DSN
LANGGRAPH_STORE_MONGODB_URI=        # MongoDB connection URI
```

| Backend | Implementation | Package |
|---|---|---|
| Redis | `_LazyAsyncRedisStore` → `AsyncRedisStore` | langgraph-checkpoint-redis |
| Postgres | `_LazyAsyncPostgresStore` → `AsyncPostgresStore` | langgraph-checkpoint-postgres |
| MongoDB | `_LazyAsyncMongoDBStore` (custom, motor-based) | motor |

### Helm Chart (`langgraph-redis`)

- New subchart: `charts/ai-platform-engineering/charts/langgraph-redis/`
- Image: `redis/redis-stack-server:7.2.0-v13` (includes RedisJSON + RediSearch)
- PVC-backed persistence (2Gi default)
- Controlled via `global.langgraphRedis.enabled` condition
- Non-root container with security context hardening

### Agent Wiring

- `deep_agent.py`: `InMemorySaver()` replaced with `create_checkpointer()`
- `base_langgraph_agent.py`: Module-level `MemorySaver()` replaced with `get_checkpointer()` singleton

## Components Changed

### Python
- `ai_platform_engineering/utils/checkpointer.py` (new) — Checkpointer factory (memory/redis/postgres/mongodb)
- `ai_platform_engineering/utils/store.py` — Store factory with `_LazyAsyncRedisStore`, `_LazyAsyncPostgresStore`, `_LazyAsyncMongoDBStore`
- `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` — Uses `create_checkpointer()`
- `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py` — Uses `get_checkpointer()`
- `pyproject.toml` — Added `langgraph-checkpoint-redis>=0.3.5`, `langgraph-checkpoint-postgres>=2.0.0`, `langgraph-checkpoint-mongodb>=0.3.0`, `motor>=3.4.0`

### Helm
- `charts/ai-platform-engineering/charts/langgraph-redis/` (new) — Redis Stack subchart
- `charts/ai-platform-engineering/Chart.yaml` — Added `langgraph-redis` dependency
- `charts/ai-platform-engineering/values.yaml` — Added `global.langgraphRedis.enabled`, postgres/mongodb to `checkpointPersistence` and `memoryPersistence`
- `charts/ai-platform-engineering/charts/supervisor-agent/values.yaml` — Added postgres/mongodb to `checkpointPersistence`, mongodb to `memoryPersistence`
- `charts/ai-platform-engineering/charts/supervisor-agent/templates/deployment.yaml` — Postgres/MongoDB checkpoint and store env vars
- `charts/ai-platform-engineering/charts/agent/values.yaml` — Added postgres/mongodb to `checkpointPersistence`
- `charts/ai-platform-engineering/charts/agent/templates/deployment.yaml` — Postgres/MongoDB checkpoint env vars

### Tests
- `tests/test_checkpointer.py` — 29 unit tests (config, factory, singleton for all backends)
- `tests/test_redis_store.py` — 36 unit tests (Redis, Postgres, MongoDB store wrappers + factory)

## Related

- Spec: `.specify/specs/langgraph-redis-persistence.md`
- ADR: `2026-02-26-cross-thread-langgraph-store.md` (original persistence design)
- PR: #861 (cross-thread memory store)
