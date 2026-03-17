---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-05: ADR: ArgoCD Agent OOM Analysis & Resolution"
---

# ADR: ArgoCD Agent OOM Analysis & Resolution

**Status**: 🟢 In-use
**Category**: Bug Fixes & Performance
**Date**: November 5, 2025
**Signed-off-by**: Sri Aradhyula \<sraradhy@cisco.com\>

## Motivation
The ArgoCD agent was experiencing OOM (Out of Memory) kills in Docker when processing queries that list all ArgoCD applications (819 apps).


## Best Practices

### For All Agents Handling Large Datasets:

1. **Add Pagination Guidelines to System Prompts**
   - Set thresholds (e.g., >50 items → paginate)
   - Provide clear instructions for summary + first N items
   - Inform users about filtering options

2. **Monitor Memory Usage**
   - Native: `ps -p <PID> -o rss,vsz`
   - Docker: `docker stats <container>`
   - Look for spikes >500MB

3. **Test with Large Datasets**
   - Test queries that return max results
   - Monitor memory during response generation
   - Verify streaming completes successfully

4. **LLM Output Limits**
   - GPT-4o: ~16K tokens output limit
   - Claude: Similar limits apply
   - Always paginate or summarize large result sets


## Testing Results

✅ **After Fix:**
- Small queries (10-50 apps): Complete successfully
- Large queries (819 apps): Return summary + first 20 apps
- Memory stays under 500MB
- No stream disconnections
- No Docker OOM kills


## Related

- Architecture: [architecture.md](./architecture.md)
