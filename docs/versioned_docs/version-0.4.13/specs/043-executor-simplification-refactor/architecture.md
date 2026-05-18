---
sidebar_position: 1
id: 043-executor-simplification-refactor-architecture
sidebar_label: Architecture
---

# Architecture: ADR: Agent Executor Simplification Refactor

**Date**: 2026-01-16

## Solution / Implementation

### 1. StreamState Dataclass

Introduced a `StreamState` dataclass to centralize execution state:

```python
@dataclass
class StreamState:
    """Tracks streaming state for A2A protocol."""
    # Content accumulation
    supervisor_content: List[str] = field(default_factory=list)
    sub_agent_content: List[str] = field(default_factory=list)
    sub_agent_datapart: Optional[Dict] = None

    # Artifact tracking
    streaming_artifact_id: Optional[str] = None
    seen_artifact_ids: set = field(default_factory=set)
    first_artifact_sent: bool = False

    # Completion flags
    sub_agent_complete: bool = False
    task_complete: bool = False
    user_input_required: bool = False
```

### 2. Extracted Helper Methods

Decomposed the monolithic `execute()` into focused, testable methods:

| Method | Purpose |
|--------|---------|
| `_get_final_content()` | Determines final content (supervisor vs sub-agent) |
| `_is_tool_notification()` | Detects tool call notifications |
| `_get_artifact_name_for_notification()` | Names artifacts appropriately |
| `_normalize_content()` | Handles AWS Bedrock list format |
| `_send_artifact()` | Centralized artifact sending |
| `_send_completion()` | Sends task completion status |
| `_send_error()` | Sends error status |
| `_handle_sub_agent_artifact()` | Processes sub-agent artifacts |
| `_handle_task_complete()` | Handles task completion |
| `_handle_user_input_required()` | Handles user input requests |
| `_handle_streaming_chunk()` | Processes streaming content |
| `_handle_stream_end()` | Handles stream termination |

### 3. Removed Dead Code

| Removed | Reason |
|---------|--------|
| `RoutingType` enum | Never used in production |
| `RoutingDecision` class | Never used in production |
| `_parse_env_keywords()` | Part of unused routing |
| `_detect_sub_agent_query()` | Part of unused routing |
| `_route_query()` | Part of unused routing |
| `_stream_from_sub_agent()` | Never called |
| `_stream_from_multiple_agents()` | Never called |
| `_extract_text_from_artifact()` | Unused |
| Feature flags | Never activated in production |

### 4. Added Streaming Fix (PR #647)

Incorporated the streaming duplication fix:

```python
# Handle clear_accumulators signal for retry/fallback
if isinstance(event, dict) and event.get('clear_accumulators'):
    logger.info("🗑️ Received clear_accumulators signal - clearing accumulated content")
    state.supervisor_content.clear()
    state.sub_agent_content.clear()
```


## Code Metrics After

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total lines | 971 | 613 | **-36.4%** |
| execute() method | ~722 lines | ~155 lines | **-78.5%** |
| Dead methods | 8 | 0 | **-100%** |
| Feature flags | 4 | 0 | **-100%** |
| State variables | 15+ scattered | 1 dataclass | **Clean** |


## Features Preserved

All active features are maintained:

| Feature | Status |
|---------|--------|
| `execute()` | ✅ Refactored |
| `cancel()` | ✅ Kept |
| `_safe_enqueue_event()` | ✅ Kept |
| `_parse_execution_plan_text()` | ✅ Kept |
| `_format_execution_plan_text()` | ✅ Kept |
| `_ensure_execution_plan_completed()` | ✅ Kept |
| `new_data_artifact()` | ✅ Kept |
| Streaming duplication fix | ✅ Added |
| Sub-agent artifact handling | ✅ Kept |
| Tool notification detection | ✅ Extracted |
| User input handling | ✅ Extracted |
| Error handling | ✅ Extracted |


## Files Modified

```
ai_platform_engineering/
└── multi_agents/
    └── platform_engineer/
        └── protocol_bindings/
            └── a2a/
                └── agent_executor.py
                    - Reduced from 971 to 613 lines
                    - Added StreamState dataclass
                    - Extracted 12 helper methods
                    - Removed 8 dead methods
                    - Removed 4 feature flags
                    - Added clear_accumulators handling
```


## Rollback Plan

If issues arise, the original code is available:

```bash
# View original from main branch
git show origin/main:ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py

# Restore if needed
git checkout origin/main -- ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py
```


## Notes

- This refactor maintains full backward compatibility
- No changes to the A2A protocol or agent.py
- All existing clients continue to work unchanged
- The removed routing logic was never enabled in production (all flags defaulted to off)


## Related

- Spec: [spec.md](./spec.md)
