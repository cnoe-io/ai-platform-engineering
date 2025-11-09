# ADR: A2A Artifact ID Tracking for Protocol Compliance

**Status**: 🟢 In-use
**Date**: 2025-11-09
**Author**: Platform Engineering Team
**Related**: A2A Protocol, Multi-Agent System, Streaming

---

## Context

The Platform Engineer executor was generating hundreds of A2A protocol warnings when forwarding artifacts from sub-agents:

```
[WARNING] [append_artifact_to_task:102] Received append=True for nonexistent artifact
index fbdae642-60de-4899-a4cd-ec69ac449d0c in task aa29678e-869b-4591-899e-943c7cebf6a2.
Ignoring chunk.
```

These warnings indicated violations of the A2A protocol specification for artifact streaming.

### A2A Protocol Requirement

Per the A2A protocol specification:

1. **First chunk** of an artifact: Must use `append=False` to **create** the artifact
2. **Subsequent chunks** of the same artifact: Must use `append=True` to **append** to the existing artifact

The append flag must be tracked **per artifact ID**, not globally across all artifacts.

### Problem Description

The executor was using a single global `first_artifact_sent` boolean flag to determine whether to set `append=True` or `append=False` when forwarding artifacts. This caused protocol violations when multiple artifacts were in flight:

**Bug Flow:**
1. Supervisor creates artifact A (ID: `aaaa-1111`) → sets `first_artifact_sent = True`
2. Sub-agent creates artifact B (ID: `bbbb-2222`) - this is the **first chunk** for artifact B
3. Executor checks: `first_artifact_sent == True`, so uses `append=True`
4. Executor sends artifact B with `append=True` ❌ **VIOLATION**
5. A2A SDK rejects: "Artifact B doesn't exist yet, can't append to it!"

### Affected Scenarios

- **Sub-agent streaming**: Sub-agents create their own artifacts with unique IDs
- **Parallel tool calls**: Multiple tools running simultaneously, each creating artifacts
- **Mixed content types**: Supervisor streaming + sub-agent responses in the same request
- **Tool notifications**: Tool start/end notifications creating separate artifacts

---

## Decision

**Implement per-artifact-ID tracking using a set-based approach** instead of a global boolean flag.

### Implementation

#### 1. Track Seen Artifact IDs (Line 981)

```python
# Before (❌ Global flag)
first_artifact_sent = False

# After (✅ Per-ID tracking)
first_artifact_sent = False  # Keep for backward compatibility
seen_artifact_ids = set()    # Track which artifact IDs exist
```

#### 2. Check Per Artifact ID (Lines 1145-1157)

```python
# Before (❌ Global check)
use_append = first_artifact_sent
if not first_artifact_sent:
    first_artifact_sent = True

# After (✅ Per-ID check)
artifact_id = artifact.get('artifactId')
if artifact_id in seen_artifact_ids:
    # Artifact already exists, append to it
    use_append = True
else:
    # First time seeing this artifact ID, create it
    use_append = False
    seen_artifact_ids.add(artifact_id)
    first_artifact_sent = True  # Also track globally
```

#### 3. Apply to All Artifact Types

Updated three artifact creation paths:
- **Sub-agent artifacts** (lines 1145-1157): From sub-agents via artifact-update events
- **Tool notifications** (line 1367): Tool start/end notifications
- **Supervisor streaming** (line 1389): Supervisor's own streaming content

#### 4. Add Observability (Lines 1160-1171)

Added structured logging in table format to track artifact lifecycle:

```python
logger.info(
    f"\n{'='*80}\n"
    f"📊 A2A ARTIFACT TRACKING\n"
    f"{'='*80}\n"
    f"  Artifact ID     : {artifact_id}\n"
    f"  Artifact Name   : {artifact_name}\n"
    f"  Previously Seen : {was_seen}\n"
    f"  Append Flag     : {use_append}\n"
    f"  Status          : {status}\n"
    f"  Total Tracked   : {len(seen_artifact_ids)} artifacts\n"
    f"{'='*80}"
)
```

---

## Consequences

### Positive

✅ **Protocol Compliance**: Zero A2A warnings, strict protocol adherence
✅ **Correct Behavior**: Each artifact's first chunk properly creates it
✅ **Scalability**: Handles unlimited concurrent artifacts
✅ **Observability**: Clear logs showing artifact lifecycle
✅ **No Breaking Changes**: Backward compatible, no API changes
✅ **Performance**: Set lookups are O(1), negligible overhead

### Negative

⚠️ **Memory Usage**: `seen_artifact_ids` set grows with number of artifacts per request
  - **Mitigation**: Set is cleared at start of each request (line 981)
  - **Impact**: Minimal - typical requests have 1-20 artifacts

⚠️ **Log Verbosity**: Table logging adds lines to logs
  - **Mitigation**: Only logs on artifact creation (not appends)
  - **Impact**: Acceptable - aids debugging, can be filtered

### Neutral

➡️ **Code Complexity**: Added 15 lines of tracking logic
➡️ **Testing**: Requires multi-artifact scenarios for validation

---

## Alternatives Considered

### Alternative 1: Dictionary with Metadata

**Approach**: Use `dict[artifact_id, metadata]` instead of `set`

```python
seen_artifacts = {}  # artifact_id -> {name, created_at, chunk_count}
```

**Rejected**:
- ❌ Overkill for simple existence check
- ❌ More memory overhead
- ✅ Set is simpler and sufficient

### Alternative 2: Per-Artifact-Name Tracking

**Approach**: Track by artifact name (`streaming_result`, `tool_notification_start`, etc.)

```python
seen_artifact_names = set()
```

**Rejected**:
- ❌ Multiple artifacts can have same name but different IDs
- ❌ Would still cause violations
- ❌ Artifact ID is the unique identifier, not name

### Alternative 3: Fix Upstream in A2A SDK

**Approach**: Modify A2A SDK to auto-detect and fix append flags

**Rejected**:
- ❌ Violates protocol specification
- ❌ Masks bugs in agent implementations
- ❌ Not our codebase to modify
- ✅ Better to fix our implementation

---

## Implementation Details

### Files Modified

1. **`agent_executor.py`** (4 locations)
   - Line 981: Added `seen_artifact_ids` set
   - Lines 1145-1171: Sub-agent artifact tracking + logging
   - Line 1367: Tool notification tracking
   - Lines 1389-1403: Supervisor streaming tracking

### Before vs After Comparison

| Scenario | Before | After |
|----------|--------|-------|
| First chunk, artifact A | `append=False` ✅ | `append=False` ✅ |
| Second chunk, artifact A | `append=True` ✅ | `append=True` ✅ |
| **First chunk, artifact B** | `append=True` ❌ | `append=False` ✅ |
| Second chunk, artifact B | `append=True` ✅ | `append=True` ✅ |
| Concurrent artifacts | Mixed/broken ❌ | All correct ✅ |

### Test Scenarios

#### Scenario 1: Sub-Agent with Streaming
```
Request: "use Jarvis agent and get llm keys"

Expected Log Sequence:
1. CREATE supervisor artifact (streaming_result)
2. CREATE sub-agent artifact (complete_result) ← This was failing before
3. APPEND to sub-agent artifact
4. Final result with DataPart
```

#### Scenario 2: Parallel Tool Calls
```
Request: "check github and jira simultaneously"

Expected Log Sequence:
1. CREATE tool_notification_start (github)
2. CREATE tool_notification_start (jira) ← This was failing before
3. CREATE artifact for github results
4. CREATE artifact for jira results ← This was failing before
```

---

## Metrics

### Before Fix (Measured 2025-11-09 09:19:44)

- **A2A Warnings**: 274 warnings in single request
- **Protocol Violations**: ~50% of sub-agent artifact chunks
- **User Impact**: None visible (SDK silently ignores)
- **Log Pollution**: Hundreds of warning lines

### After Fix (Measured 2025-11-09 09:26:20)

- **A2A Warnings**: 0 warnings ✅
- **Protocol Violations**: 0% ✅
- **User Impact**: None
- **Log Quality**: Clean, informative tables

---

## Migration Guide

### For Developers

No action required - the fix is transparent and backward compatible.

### For Operations

1. **Monitor logs** for new table-format artifact tracking:
   ```
   📊 A2A ARTIFACT TRACKING
     Status: ✅ CREATE
   ```

2. **Alert on violations** (shouldn't happen):
   ```bash
   # Set up alert for this pattern:
   "WARNING.*nonexistent artifact"
   ```

3. **Review artifact counts** if memory concerns arise:
   ```
   Total Tracked: N artifacts
   ```
   Typical: 1-20 per request
   Alert if: >100 per request

---

## References

- **A2A Protocol Spec**: Agent-to-Agent Communication Protocol
- **Related Code**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/`
- **Issue**: A2A warnings in logs (discovered during duplication fix)
- **Related ADR**: [2025-11-08 A2A DataPart Structured Responses](./2025-11-08-a2a-datapart-structured-responses.md)

---

## Follow-Up Actions

- [x] Implement per-artifact-ID tracking
- [x] Add observability logging
- [x] Test with sub-agent streaming
- [x] Test with parallel tool calls
- [x] Verify zero A2A warnings
- [ ] Add unit tests for artifact tracking logic
- [ ] Document in integration tests
- [ ] Update A2A client documentation

---

## Lessons Learned

1. **Protocol Compliance Matters**: Even "silent" warnings indicate violations
2. **Per-Instance Tracking**: Always track by unique ID, not globally
3. **Observability First**: Table-format logs helped identify the issue
4. **Test Multi-Entity Scenarios**: Single-agent tests missed this bug
5. **A2A SDK is Strict**: Protocol violations are caught and logged

---

## Questions & Answers

**Q: Why keep `first_artifact_sent` if using `seen_artifact_ids`?**
A: Backward compatibility and as a quick global check for optimization.

**Q: What if `artifact_id` is None?**
A: The A2A SDK always generates IDs for artifacts. If None, it's a bug upstream.

**Q: Does this fix affect performance?**
A: Negligible - set lookups are O(1), adds ~1μs per artifact.

**Q: Could this fix other issues?**
A: Yes - may fix edge cases with artifact race conditions in parallel streaming.

**Q: Should we clear `seen_artifact_ids` between requests?**
A: Yes - it's already scoped to each `execute()` call (line 981).

---

**Signed-off-by**: Sri Aradhyula <sraradhy@cisco.com>


