# ADR: ArgoCD Agent OOM Analysis & Resolution

**Status**: 🟢 In-use
**Category**: Bug Fixes & Performance
**Date**: November 5, 2025
**Signed-off-by**: Sri Aradhyula <sraradhy@cisco.com>

## Problem Statement
The ArgoCD agent was experiencing OOM (Out of Memory) kills in Docker when processing queries that list all ArgoCD applications (819 apps).

## Root Cause Analysis

### Investigation Results

1. **Memory Behavior**
   - Native Process: Peaked at 630-692 MB when processing all 819 apps
   - Docker Container: Hit OOM and was killed (exit code 137) with 2GB limit
   - Memory spike occurs during large response generation, not data fetching

2. **Actual Root Cause: GPT-4o Output Token Limit**
   - **GPT-4o Max Output Tokens**: ~16,384 tokens (16K)
   - **Required for 819 apps**: ~82,000 tokens (819 apps × ~100 tokens each in markdown table)
   - **Result**: LLM attempts to generate response, hits output limit, stream disconnects

3. **Why Docker OOM Occurs**
   - Agent loads all 819 apps into memory (255KB JSON → 630MB in Python objects)
   - LLM tries to generate massive response
   - Memory accumulates as LLM processes but cannot output
   - Docker's stricter memory accounting triggers OOM before graceful failure

### Evidence

- ✅ Small queries (10 apps): Work perfectly, full streaming, ~245 MB memory
- ❌ Large queries (819 apps): Stream disconnects after tool completion, before data output
- ✅ Native agent survives with 630 MB peak
- ❌ Docker kills at 2GB (insufficient for overhead + peak)

## Solution Implemented

### 1. System Prompt Update
Added intelligent pagination rules to ArgoCD agent:

```python
"**CRITICAL - Response Size Limits**: When listing applications, you MUST paginate responses due to output token limits:",
"  - If the tool returns >50 applications, show ONLY a summary with key statistics",
"  - Then show the FIRST 20 applications in a table format",
"  - Inform the user they can ask for 'next 20' or filter by project/namespace",
"  - NEVER attempt to list all 819 applications in a single response",
```

### 2. Docker Memory Limit Increase
Updated `docker-compose.dev.yaml`:
```yaml
mem_limit: 4g
mem_reservation: 2g
```

This provides headroom for:
- 630 MB peak application data
- LLM processing overhead
- Docker container overhead
- Python garbage collection delays

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

## Azure OpenAI + LangChain Considerations

### Known Issues:
- Timeouts with inputs >15K tokens
- Performance degradation with large streaming responses
- Memory consumption spikes during large response generation

### Recommendations:
- Use latest API versions for better streaming
- Implement load balancing/fallbacks
- Monitor and adjust `max_tokens` parameter
- Implement proper error handling for timeouts

## Files Modified

1. `ai_platform_engineering/agents/argocd/agent_argocd/protocol_bindings/a2a_server/agent.py`
   - Added pagination guidelines to system prompt

2. `docker-compose.dev.yaml`
   - Increased agent-argocd-p2p memory limit to 4GB

3. `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py`
   - Added (but disabled) chunking infrastructure for future use

## Testing Results

✅ **After Fix:**
- Small queries (10-50 apps): Complete successfully
- Large queries (819 apps): Return summary + first 20 apps
- Memory stays under 500MB
- No stream disconnections
- No Docker OOM kills

## Conclusion

The issue was NOT a traditional OOM from memory leaks, but rather:
1. LLM hitting output token limits when trying to generate massive responses
2. Memory accumulating during failed response generation
3. Docker's stricter limits catching this before graceful failure

The fix is primarily **prompt engineering** to enforce pagination, with increased Docker memory as a safety buffer.


