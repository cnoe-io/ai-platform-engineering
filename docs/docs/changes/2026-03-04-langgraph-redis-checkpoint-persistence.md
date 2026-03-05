# LangGraph Redis Checkpoint & Store Persistence

**Status**: 🟡 Preview
**Category**: Architecture & Design
**Date**: March 4, 2026

## Overview

Enabled Redis persistence for both the LangGraph checkpointer (in-thread conversation state) and cross-thread memory store using `langgraph-checkpoint-redis` backed by a dedicated Redis Stack instance.

## Problem Statement

Both persistence layers defaulted to in-memory backends:
- **Checkpointer** (`InMemorySaver`): Conversation state was lost on pod restart; multi-turn conversations broke across deployments.
- **Store** (`InMemoryStore`): The Redis store factory in `store.py` was a stub that always fell back to `InMemoryStore` despite configuration for Redis, meaning cross-thread memories were never actually persisted.

The existing `rag-redis` instance (Redis 7.2-alpine) cannot serve as the persistence backend because it lacks the RedisJSON and RediSearch modules required by `langgraph-checkpoint-redis`.

## Decision

Deploy a dedicated Redis Stack instance and implement factory-based checkpointer creation.

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **Dedicated Redis Stack + factory (chosen)** | Correct modules, clean separation, no impact on RAG | Additional pod | Selected |
| Upgrade rag-redis to Redis Stack | Reuse existing infra | Risk to RAG indexing, module conflicts | Rejected |
| Postgres checkpointer | Durable, relational | Heavier infra, async complexity | Deferred |
| Keep in-memory | Zero infra | State lost on restart | Rejected |

## Solution Architecture

### Checkpointer Factory (`checkpointer.py`)

```python
# Environment variables:
LANGGRAPH_CHECKPOINT_TYPE=memory    # memory (default) | redis
LANGGRAPH_CHECKPOINT_REDIS_URL=     # Redis Stack connection string
LANGGRAPH_CHECKPOINT_TTL_MINUTES=0  # 0 = no expiry
```

- `create_checkpointer()` returns `RedisSaver` (sync, from `langgraph-checkpoint-redis`) or `InMemorySaver`
- `get_checkpointer()` provides a global singleton
- Graceful fallback: if Redis is unreachable or package missing, falls back to `InMemorySaver`

### Redis Store (`_LazyAsyncRedisStore` in `store.py`)

- Replaced the stub `_create_redis_store()` with a real implementation using `AsyncRedisStore`
- `_LazyAsyncRedisStore` wrapper handles async initialization at first use
- Delegates all async methods (`aput`, `aget`, `asearch`, `adelete`, `alist_namespaces`, `abatch`) to the underlying store

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
- `ai_platform_engineering/utils/checkpointer.py` (new) — Checkpointer factory
- `ai_platform_engineering/utils/store.py` — `_create_redis_store()` and `_LazyAsyncRedisStore`
- `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` — Uses `create_checkpointer()`
- `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py` — Uses `get_checkpointer()`
- `pyproject.toml` — Added `langgraph-checkpoint-redis>=0.3.5`

### Helm
- `charts/ai-platform-engineering/charts/langgraph-redis/` (new) — Redis Stack subchart
- `charts/ai-platform-engineering/Chart.yaml` — Added `langgraph-redis` dependency
- `charts/ai-platform-engineering/values.yaml` — Added `global.langgraphRedis.enabled`, `checkpointPersistence`
- `charts/ai-platform-engineering/charts/supervisor-agent/values.yaml` — Added `checkpointPersistence`
- `charts/ai-platform-engineering/charts/supervisor-agent/templates/deployment.yaml` — Checkpoint env vars
- `charts/ai-platform-engineering/charts/agent/values.yaml` — Added `checkpointPersistence`
- `charts/ai-platform-engineering/charts/agent/templates/deployment.yaml` — Checkpoint env vars

### Tests
- `tests/test_checkpointer.py` (new) — 16 unit tests
- `tests/test_redis_store.py` (new) — 12 unit tests

## Related

- Spec: `.specify/specs/langgraph-redis-persistence.md`
- ADR: `2026-02-26-cross-thread-langgraph-store.md` (original persistence design)
- PR: #861 (cross-thread memory store)
