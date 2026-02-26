# Automatic Fact Extraction via LangMem

**Status**: Accepted
**Category**: Architecture & Design
**Date**: February 26, 2026

## Overview

Added automatic background fact extraction from conversations using LangMem's `create_memory_store_manager`. After each agent response, a background task analyzes the conversation and persists extracted facts, preferences, and context to the cross-thread LangGraph Store. This enables the agent to recall user-specific information across threads without requiring the user to repeat themselves.

## Problem Statement

The cross-thread store (introduced in the Cross-Thread LangGraph Store ADR) only received data when context compression triggered -- which required the context window to be nearly full. Short conversations produced no cross-thread memory at all, meaning the `("memories", user_id)` namespace was effectively empty. Users had to re-explain their environment, preferences, and project details in every new conversation.

## Decision

Use LangMem's `create_memory_store_manager` API to automatically extract facts from every conversation turn, running as a background task after the agent responds.

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **create_memory_store_manager (chosen)** | Native BaseStore integration, automatic search/insert/update/delete, consolidates duplicates | Extra LLM call per turn | Selected |
| create_memory_manager + manual store writes | More control over extraction output | No store integration, must manually search/write/deduplicate | Rejected |
| Inline extraction during compression only | No extra LLM calls | Facts only captured when context window is near-full; short conversations produce no memories | Rejected (status quo) |
| Custom fact extraction prompt | Full control over prompt | Reinvents what LangMem already provides, no dedup/update logic | Rejected |

## Solution Architecture

### Background Extraction Flow

1. User sends message; agent streams response back to user.
2. After the response stream completes, a background `asyncio.create_task()` launches fact extraction.
3. The `MemoryStoreManager` searches the store for existing memories relevant to this conversation.
4. It analyzes the conversation messages alongside existing memories using an LLM.
5. It generates insert/update/delete operations and applies them to the store.
6. On the next conversation (same or new thread), `store_get_cross_thread_context` retrieves these facts.

### Memory Types Extracted

LangMem's memory manager extracts three categories:

- **Semantic**: Facts, preferences, relationships (e.g., "User's team uses ArgoCD on prod-west cluster")
- **Episodic**: Past experiences and conversation context (e.g., "User debugged an OOM issue in the monitoring namespace")
- **Procedural**: Behavioral patterns (e.g., "User prefers concise responses with YAML examples")

### Feature Flag

Extraction is controlled by `ENABLE_FACT_EXTRACTION` (default: `false`). This is disabled by default because:

- It adds one LLM call per conversation turn (cost/latency consideration)
- Teams should opt-in after evaluating cost vs. benefit
- InMemoryStore (default) loses data on restart, so extraction is most useful with Redis/Postgres store backends

### Configuration

```bash
ENABLE_FACT_EXTRACTION=false           # Enable/disable background fact extraction
FACT_EXTRACTION_MODEL=                 # Model for extraction (empty = use default LLM)
```

## Components Changed

- `ai_platform_engineering/utils/agent_memory/fact_extraction.py` (new) - Extraction logic, feature flag, MemoryStoreManager factory
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` - Background task launch after stream()
- `ai_platform_engineering/multi_agents/agent_registry.py` - Added `FACT_EXTRACTION` to `DEFAULT_REGISTRY_EXCLUSIONS`
- `.env.example` / `docker-compose.dev.yaml` - New environment variables
- `.specify/specs/cross-thread-store.md` - Updated spec with Phase 4
- `tests/test_fact_extraction.py` (new) - 65 unit tests covering feature flag, config, extraction, store compatibility, edge cases
- `tests/test_store.py` (enhanced) - 86 unit tests covering store factory, operations, cross-thread context, integration
- `scripts/test_fact_extraction_live.py` (new) - Live integration test with recall verification and user isolation

## Dependency: cnoe-agent-utils

The `trace_agent_stream` decorator in `cnoe-agent-utils` required a fix to forward `**kwargs` so that `user_id` can be propagated through the decorated `stream()` method. This fix is backward-compatible.

- PR: https://github.com/cnoe-io/cnoe-agent-utils/pull/32

## Related

- ADR: `2026-02-26-cross-thread-langgraph-store.md` (Cross-thread store infrastructure)
- ADR: `2025-12-13-context-management-and-resilience.md` (LangMem context management)
- Spec: `.specify/specs/cross-thread-store.md`
