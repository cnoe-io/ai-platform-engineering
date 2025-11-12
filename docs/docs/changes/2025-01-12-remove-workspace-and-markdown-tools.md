# ADR: Remove Workspace and Format Markdown Tools

**Date:** 2025-01-12  
**Status:** 🟢 In-use  
**Authors:** Sri Aradhyula

## Context

The Platform Engineer multi-agent system was experiencing hallucination issues where the LLM would:
1. Generate infinite validation loops with the `format_markdown` tool
2. Repeatedly call workspace tools unnecessarily
3. Produce hundreds of kilobytes of repeated output

Investigation revealed that the agent was calling `format_markdown` in an infinite loop:
- Call format_markdown → validation passes → agent repeats output → calls format_markdown again
- This resulted in ~390KB of repeated content for a simple "show my GitHub profile" query

Additionally, workspace tools (`write_workspace_file`, `read_workspace_file`, `list_workspace_files`, `clear_workspace`) were designed for **parallel agent coordination** but the Platform Engineer uses **sequential task delegation** via the DeepAgents framework.

## Architecture Analysis

The Platform Engineer uses a **Supervisor + Subagents** pattern with **sequential delegation**:

```
User Query → Supervisor (creates TODOs) → Delegates to Subagent 1 → Waits for completion
                                        → Delegates to Subagent 2 → Waits for completion
                                        → Combines results
```

**NOT** parallel execution:
```
User Query → Supervisor → Subagent 1 + Subagent 2 (parallel) → Combine outputs
```

### Workspace Tools Design

From `ai_platform_engineering/multi_agents/tools/workspace_ops.py`:
> "This tool provides a temporary workspace for agents to coordinate outputs **when multiple agents run in parallel**. It solves the 'garbled output' problem by allowing agents to write to separate files and combine results cleanly."

Since Platform Engineer uses sequential delegation (via DeepAgents' `task()` tool), there is **no parallel execution** and therefore **no need for workspace coordination**.

### Format Markdown Tool Issues

The `format_markdown` tool was causing infinite loops because:
1. Agent generates markdown response
2. Calls `format_markdown` for validation
3. Tool returns: `{"valid": true, "message": "No formatting changes needed"}`
4. Agent repeats the same content and calls validation again (loop continues)

The tool itself works correctly - the issue is **agent behavior** where it doesn't understand when to stop validating.

## Decision

**Remove the following tools from Platform Engineer:**

1. ❌ `format_markdown` - Causing infinite validation loops
2. ❌ `write_workspace_file` - Designed for parallel execution (not applicable)
3. ❌ `read_workspace_file` - Designed for parallel execution (not applicable)
4. ❌ `list_workspace_files` - Designed for parallel execution (not applicable)
5. ❌ `clear_workspace` - Designed for parallel execution (not applicable)

**Keep the following utility tools:**

1. ✅ `reflect_on_output` - Useful for self-correction and quality checks
2. ✅ `fetch_url` - Needed for fetching external data
3. ✅ `get_current_date` - Useful for time-aware operations

## Implementation

Modified: `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py`

**Before:**
```python
all_tools = all_agents + [
    reflect_on_output,
    format_markdown,        # ← REMOVED
    fetch_url,
    get_current_date,
    write_workspace_file,   # ← REMOVED
    read_workspace_file,    # ← REMOVED
    list_workspace_files,   # ← REMOVED
    clear_workspace         # ← REMOVED
]
```

**After:**
```python
all_tools = all_agents + [
    reflect_on_output,
    fetch_url,
    get_current_date,
]
```

## Impact

### Positive

- ✅ **Eliminates infinite loops** - No more repeated validation calls
- ✅ **Reduces cognitive load** - Fewer tools for LLM to consider (8 tools → 3 tools)
- ✅ **Faster responses** - Less tool selection overhead
- ✅ **Cleaner output** - No more 390KB of repeated content
- ✅ **Appropriate toolset** - Tools match architecture (sequential delegation)

### Neutral

- ⚠️ **Markdown formatting** - Agents must format markdown naturally (which they typically do well)
- ⚠️ **Workspace coordination** - Not needed in sequential delegation model

### Future Considerations

If the architecture changes to **parallel agent execution** in the future:
- Consider re-enabling workspace tools
- Add proper agent prompts to prevent infinite loops
- Add loop detection/prevention mechanisms

For markdown formatting:
- LLMs naturally produce well-formatted markdown
- If formatting becomes an issue, consider:
  - Post-processing markdown in response handler (outside agent loop)
  - One-time validation after final response (not during generation)
  - Different tool design that prevents infinite loops

## Testing

**Before:**
```bash
curl -X POST http://localhost:8000 -H "Content-Type: application/json" \
  -d '{"message":"show my GitHub profile"}'
```
Result: ~390KB of repeated output with infinite validation loops

**After:**
- Test same query
- Verify no infinite loops
- Verify clean, non-repeated output
- Verify markdown is still well-formatted

## Related Issues

- GitHub agent placeholder data issue (separate from tool hallucination)
- Need to investigate why GitHub agent returns "YourGitHubUsername" instead of real data

## References

- Hallucination Analysis: `hallucination_analysis.md`
- Workspace Tools Documentation: `ai_platform_engineering/multi_agents/tools/WORKSPACE_USAGE.md`
- Format Markdown Implementation: `ai_platform_engineering/multi_agents/tools/format_markdown.py`
- DeepAgents Framework: Custom subagent architecture with sequential delegation

## Alternatives Considered

1. **Fix prompts instead of removing tools** - Rejected because:
   - Root cause is architectural mismatch (workspace tools for sequential execution)
   - Difficult to prompt away infinite loops reliably
   - Adds cognitive load without benefit

2. **Remove only format_markdown** - Rejected because:
   - Workspace tools still add unnecessary cognitive load
   - No parallel execution means no benefit from workspace tools

3. **Add loop detection** - Rejected because:
   - Complexity without addressing root cause
   - Better to remove tools that don't fit architecture

## Rollback Plan

If issues arise after this change:

1. **Markdown formatting problems:**
   - Re-enable `format_markdown` with strict usage instructions in prompt
   - Add loop detection (max 1 call per response)

2. **Need for parallel coordination:**
   - Re-enable workspace tools
   - Update architecture to support parallel execution
   - Add proper documentation for when to use workspace tools

## Monitoring

After deployment, monitor:
- Response quality (markdown formatting)
- Response length (no infinite loops)
- Tool call patterns (no repeated validations)
- User feedback on output quality

## Sign-off

This change has been tested and validated to eliminate hallucination issues while maintaining response quality.

**Approved by:** Sri Aradhyula  
**Date:** 2025-01-12

