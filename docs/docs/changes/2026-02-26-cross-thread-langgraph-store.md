# Cross-Thread LangGraph Store

**Status**: 🟢 In-use
**Category**: Architecture & Design
**Date**: February 26, 2026

## Overview

Added cross-thread long-term memory via LangGraph Store, enabling user memories and conversation summaries to persist across threads. This complements the existing per-thread checkpointer (short-term memory) with a cross-thread store (long-term memory).

## Problem Statement

Each conversation thread was fully isolated. When a user started a new conversation, the agent had zero knowledge of prior interactions. Users had to re-explain context, preferences, and project details repeatedly.

## Decision

Use LangGraph's `BaseStore` API to implement cross-thread persistence with a pluggable backend:

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **LangGraph Store (chosen)** | Native LangGraph integration, namespace-based, supports vector search | Requires store wiring in graph compilation | Selected |
| Custom key-value store | Full control over data model | No LangGraph integration, manual wiring | Rejected |
| Shared checkpointer thread | Simple concept | Violates thread isolation, fragile | Rejected |

## Solution Architecture

### Two-Layer Persistence

```
Layer 1: Checkpointer (existing, unchanged)
  - Scope: Per thread_id
  - Stores: Raw messages (HumanMessage, AIMessage, ToolMessage)
  - Backends: InMemorySaver (default), AsyncRedisSaver, AsyncPostgresSaver

Layer 2: Store (new)
  - Scope: Per user_id, across all threads
  - Stores: User memories, conversation summaries
  - Backends: InMemoryStore (default), Redis, Postgres
```

### Data Flow

1. User sends message with JWT token containing user identity
2. Metrics middleware extracts `user_id` / `user_email` from JWT
3. Agent executor propagates `user_id` into agent config metadata
4. On new thread: agent queries store for recent summaries/memories and injects as SystemMessage
5. On context compression: LangMem saves summary to store for future threads

### Configuration

```bash
LANGGRAPH_STORE_TYPE=memory         # memory (default) | redis | postgres
LANGGRAPH_STORE_REDIS_URL=          # defaults to REDIS_URL
LANGGRAPH_STORE_POSTGRES_DSN=       # defaults to POSTGRES_DSN
LANGGRAPH_STORE_TTL_MINUTES=10080   # 7 days default
```

## Components Changed

- `ai_platform_engineering/utils/store.py` (new) - Store factory
- `deepagents/graph.py` - Added `store` parameter to graph builder
- `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` - Wires store into graph
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` - Cross-thread retrieval
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` - User identity propagation
- `ai_platform_engineering/utils/a2a_common/langmem_utils.py` - Summary persistence to store

## Related

- Spec: `.specify/specs/cross-thread-store.md`
- ADR: `2025-12-13-context-management-and-resilience.md` (LangMem context management)
