---
sidebar_position: 2
sidebar_label: Specification
---

# LangGraph Persistence Backends: Redis, Postgres, MongoDB

**Status**: 🟡 Preview
**Category**: Architecture & Design
**Date**: March 4, 2026

## Overview

Enabled pluggable persistence for both the LangGraph checkpointer (in-thread conversation state) and cross-thread memory store, supporting Redis Stack, PostgreSQL, and MongoDB backends with graceful fallback to in-memory defaults.

## Motivation

Both persistence layers defaulted to in-memory backends:
- **Checkpointer** (`InMemorySaver`): Conversation state was lost on pod restart; multi-turn conversations broke across deployments.
- **Store** (`InMemoryStore`): The Redis store factory in `store.py` was a stub that always fell back to `InMemoryStore` despite configuration for Redis, meaning cross-thread memories were never actually persisted.

The existing `rag-redis` instance (Redis 7.2-alpine) cannot serve as the persistence backend because it lacks the RedisJSON and RediSearch modules required by `langgraph-checkpoint-redis`.

## Related

- Spec: [langgraph-redis-persistence](../085-langgraph-redis-persistence/spec.md)
- ADR: `2026-02-26-cross-thread-langgraph-store.md` (original persistence design)
- PR: #861 (cross-thread memory store)

- Architecture: [architecture.md](./architecture.md)
