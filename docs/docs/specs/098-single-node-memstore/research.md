# Research: Single-Node Persistent Memory Store

**Feature**: 098-single-node-memstore
**Date**: 2026-03-25

## R-001: How do create_checkpointer() and create_store() handle synchronous callers?

**Decision**: Both factory functions are synchronous and return lazy wrappers that defer actual connection to first async use.

**Rationale**: `_build_graph_async()` in `deep_agent_single.py` is async, but `create_checkpointer()` and `create_store()` are synchronous functions. They return `_LazyAsync*` wrapper classes that inherit from `BaseCheckpointSaver` / `BaseStore`. The actual database connection is established on the first async call (`aget_tuple`, `abatch`, etc.). This means calling them from `_build_graph_async()` works identically to calling from the synchronous `_build_graph()` in the old `deep_agent.py`.

**Alternatives considered**: Async factory functions — rejected because `create_deep_agent()` accepts `store=` as a synchronous kwarg.

## R-002: What happens to the `platform_registry` imports when deep_agent.py becomes a shim?

**Decision**: The shim only re-exports `AIPlatformEngineerMAS`, `PlatformEngineerDeepAgent`, and `USE_STRUCTURED_RESPONSE`. No other symbols.

**Rationale**: `supervisor_agent.py` and `agent.py` only import `AIPlatformEngineerMAS` and `USE_STRUCTURED_RESPONSE`. The `platform_registry` reference in `test_persistence_unit.py` (lines 1038-1062) patches module-level names that will no longer exist in the shim. These two tests specifically test the old multi-node `AIPlatformEngineerMAS` class which used `platform_registry`. Since the canonical class is now `PlatformEngineerDeepAgent` (which doesn't use `platform_registry`), these tests need rewriting to test the single-node class, or removal if the multi-node-specific behavior is no longer relevant.

**Alternatives considered**: Re-exporting all symbols from `deep_agent_single` via wildcard — rejected because it would pollute the namespace and create confusion about which module is canonical.

## R-003: How should cross-thread memory be injected in agent_single.py?

**Decision**: Inject as a `SystemMessage` at the start of the messages list, only for new threads, matching the pattern in `agent.py` (multi-node binding).

**Rationale**: The multi-node `agent.py` (line 273-290) does exactly this: it checks `graph.store`, retrieves context via `store_get_cross_thread_context()`, and inserts a `SystemMessage` before the first user message. The single-node binding uses `user_email` (not `user_id`) as the identifier, which maps directly to the `user_id` parameter of the store functions. When resuming from HITL interrupts, `inputs` is a `Command` object (not a dict), so the injection must check `isinstance(inputs, dict)`.

**Alternatives considered**: Injecting into the system prompt — rejected because the system prompt is static and rebuilt only during `_build_graph_async()`.

## R-004: Where exactly should fact extraction be added in agent_single.py?

**Decision**: Between the final "YIELDING FINAL RESPONSE" log line (1790) and the `yield final_response` (1791).

**Rationale**: This mirrors `agent.py` (lines 1232-1258). The fact extraction runs as `asyncio.create_task()` — a fire-and-forget background task. Placing it just before `yield final_response` ensures:
1. All messages are available in graph state for extraction
2. The `yield` is not blocked by extraction work
3. The extraction task outlives the generator (the event loop keeps it alive)

**Alternatives considered**: After `yield final_response` — not possible since `yield` doesn't complete the generator (it resumes when the consumer calls `__anext__`).

## R-005: What symbols need to be exported from the deep_agent.py shim?

**Decision**: Three symbols: `AIPlatformEngineerMAS`, `PlatformEngineerDeepAgent`, `USE_STRUCTURED_RESPONSE`.

**Rationale**: Exhaustive grep of all consumers:

| Consumer | Imports |
|----------|---------|
| `supervisor_agent.py` | `AIPlatformEngineerMAS` |
| `agent.py` (multi-node A2A) | `AIPlatformEngineerMAS`, `USE_STRUCTURED_RESPONSE` |
| `agent_fix.py` (workshop) | `AIPlatformEngineerMAS` |
| `test_persistence_unit.py` | `deep_agent as da_module` → `da_module.AIPlatformEngineerMAS()` |

`deep_agent_single.py` already defines `AIPlatformEngineerMAS = PlatformEngineerDeepAgent` (line 1364), so re-exporting both aliases covers all consumers.

## R-006: Test impact analysis

**Decision**: Two tests in `test_persistence_unit.py` (lines 1026-1062) need rewriting.

**Rationale**: These tests (`test_checkpointer_attached_to_graph`, `test_checkpointer_disabled_with_langgraph_dev`) test multi-node-specific behavior:
- They patch `deep_agent.platform_registry` (doesn't exist in single-node)
- They patch `deep_agent.async_create_deep_agent` (single-node uses `create_deep_agent`)
- They instantiate `AIPlatformEngineerMAS()` which in the old code built the graph synchronously in `__init__`
- The single-node class requires `await ensure_initialized()`

These tests should be rewritten to verify that `create_checkpointer()` is called during graph build in the single-node class, which is the actual behavior being unified.
