# Multi-Agent Synthesis Fix

**Date**: 2026-01-22  
**Status**: 🟢 In-use  
**Author**: Sri Aradhyula &lt;sraradhy@cisco.com&gt;

## Summary

Fixed an issue where the supervisor's final answer only contained the last sub-agent's response instead of a synthesized summary from all agents when multiple agents were invoked.

## Problem

When a user query required multiple agents (e.g., "get apps for CAIPE, search for CAIPE in RAG, look for info for cnoe-io/ai-platform-engineering"), the system would:

1. Stream content from ALL agents correctly (user sees all results)
2. But return only the LAST agent's response as the final answer

### Root Cause

The `sub_agent_complete` boolean flag in `StreamState` was blocking all streaming after the **first** sub-agent completed:

```python
# OLD CODE - PROBLEMATIC
if state.sub_agent_complete:
    logger.info("🛑 Skipping streaming chunk - sub-agent already sent complete_result")
    return  # Blocks ALL subsequent streaming!
```

This caused:
1. First agent completes → `sub_agent_complete = True`
2. Second agent's streaming chunks → **SKIPPED**
3. Third agent's streaming chunks → **SKIPPED**
4. Supervisor's synthesis → **SKIPPED**

The `_get_final_content()` method would then return only the first agent's content (from artifact-updates), not the supervisor's synthesis.

## Solution

### 1. Changed from Boolean to Counter

```python
# OLD
sub_agent_complete: bool = False

# NEW
sub_agents_completed: int = 0  # Track count for multi-agent scenarios
```

### 2. Removed Streaming Block

Instead of blocking ALL streaming after first agent completes, we now continue accumulating content:

```python
# OLD
if state.sub_agent_complete:
    logger.info("🛑 Skipping streaming chunk - sub-agent already sent complete_result")
    return

# NEW
# NOTE: We no longer block streaming after sub-agent completion.
# For multi-agent scenarios, the supervisor needs to synthesize results
# from all sub-agents, so we must continue accumulating content.
```

### 3. Updated Final Content Priority

`_get_final_content()` now prioritizes differently based on scenario:

```python
def _get_final_content(self, state: StreamState) -> tuple:
    """
    Priority order for multi-agent scenarios:
    1. Sub-agent DataPart (structured data - e.g., Jarvis forms)
    2. Supervisor content (synthesis from multiple agents)
    3. Sub-agent text content (single agent fallback)
    """
    if state.sub_agent_datapart:
        return state.sub_agent_datapart, True

    # Multi-agent scenario: prefer supervisor synthesis
    if state.sub_agents_completed > 1 and state.supervisor_content:
        raw_content = ''.join(state.supervisor_content)
        return self._extract_final_answer(raw_content), False

    # Single agent: use sub-agent content
    if state.sub_agent_content:
        raw_content = ''.join(state.sub_agent_content)
        return self._extract_final_answer(raw_content), False
    
    # Fallback to supervisor content
    if state.supervisor_content:
        raw_content = ''.join(state.supervisor_content)
        return self._extract_final_answer(raw_content), False

    return '', False
```

## Behavior Changes

| Scenario | Before | After |
|----------|--------|-------|
| Single agent | Sub-agent's response used ✓ | Sub-agent's response used ✓ |
| Multiple agents | Last agent's response only ✗ | Supervisor synthesis used ✓ |
| DataPart (e.g., Jarvis forms) | DataPart used ✓ | DataPart used ✓ |

## Files Changed

- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py`

## Testing

Tested with query: "get apps for CAIPE, search for CAIPE in RAG, look for info for cnoe-io/ai-platform-engineering"

Expected result: Final answer contains synthesized summary from all three agents (ArgoCD, RAG, GitHub).

## Related ADRs

- [2026-01-16-executor-simplification-refactor.md](./2026-01-16-executor-simplification-refactor.md) - Original executor refactor
- [2025-11-05-a2a-artifact-streaming-fix.md](./2025-11-05-a2a-artifact-streaming-fix.md) - Previous streaming fixes
