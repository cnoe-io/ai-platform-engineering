---
sidebar_position: 2
sidebar_label: Specification
---

# Automatic Fact Extraction via LangMem

**Status**: Accepted
**Category**: Architecture & Design
**Date**: February 26, 2026

## Overview

Added automatic background fact extraction from conversations using LangMem's `create_memory_store_manager`. After each agent response, a background task analyzes the conversation and persists extracted facts, preferences, and context to the cross-thread LangGraph Store. This enables the agent to recall user-specific information across threads without requiring the user to repeat themselves.

## Motivation

The cross-thread store (introduced in the Cross-Thread LangGraph Store ADR) only received data when context compression triggered -- which required the context window to be nearly full. Short conversations produced no cross-thread memory at all, meaning the `("memories", user_id)` namespace was effectively empty. Users had to re-explain their environment, preferences, and project details in every new conversation.

## Testing Strategy

All persistence-related tests (289 total) pass:
- `tests/test_checkpoint.py` — 49 tests for checkpointer (thread isolation, trim, safe split, repair fallback, concurrent access, agent wiring)
- `tests/test_store.py` — 86 tests for cross-thread store (factory, put/get, user isolation, LangMem integration)
- `tests/test_fact_extraction.py` — 65 tests for fact extraction (feature flag, config, extraction, store compatibility, edge cases)
- `tests/test_persistence_unit.py` — 89 tests for persistence internals (tool-call extraction, summarization, orphan repair, config wiring)

## Related

- ADR: `2026-02-26-cross-thread-langgraph-store.md` (Checkpointer + cross-thread store infrastructure)
- ADR: [2025-12-13-context-management-and-resilience](../039-context-management-and-resilience/architecture.md) (LangMem context management)
- Spec: [cross-thread-store](../084-cross-thread-store/spec.md)

- Architecture: [architecture.md](./architecture.md)
