---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-05: ADR: A2A Artifact Streaming Race Condition Fix"
---

# ADR: A2A Artifact Streaming Race Condition Fix

**Status**: 🟢 In-use
**Category**: Bug Fixes & Performance
**Date**: November 5, 2025
**Signed-off-by**: Sri Aradhyula \<sraradhy@cisco.com\>

## Motivation

Frequent warnings in platform-engineer logs:
```
[a2a.utils.helpers] [WARNING] [append_artifact_to_task:102]
Received append=True for nonexistent artifact index 6e0ef907-0e47-433d-9329-533ec97a1015
in task 2506c285-1c00-4203-a31c-ea86892b3235. Ignoring chunk.
```


## Testing Strategy

### Verification Steps

1. **Rebuild supervisor**:
   ```bash
   docker compose -f docker-compose.dev.yaml build platform-engineer-p2p
   ```

2. **Restart services**:
   ```bash
   docker compose -f docker-compose.dev.yaml up -d platform-engineer-p2p
   ```

3. **Test streaming query**:
   ```bash
   # Send query that triggers ArgoCD agent
   curl -X POST http://localhost:8000 \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "method": "message/send",
       "params": {
         "message": {
           "role": "user",
           "parts": [{"kind": "text", "text": "Search ArgoCD for prod apps"}]
         }
       },
       "id": 1
     }'
   ```

4. **Check logs**:
   ```bash
   docker logs platform-engineer-p2p 2>&1 | grep -i "nonexistent artifact"
   # Should return no results ✅
   ```

### Expected Results

**Before Fix**:
```
[WARNING] Received append=True for nonexistent artifact index...
[WARNING] Received append=True for nonexistent artifact index...
[WARNING] Received append=True for nonexistent artifact index...
```

**After Fix**:
```
[DEBUG] ✅ Streamed FIRST chunk (with 10ms buffer): Here are the...
[DEBUG] ✅ Streamed chunk to client: prod applications...
[DEBUG] ✅ Streamed chunk to client: found 18 matches...
```


## Related Files

- **Modified**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py`
- **Related**: `ai_platform_engineering/utils/a2a_common/base_langgraph_agent_executor.py`
- **Documentation**: This file


## Related

- A2A Protocol: Agent-to-Agent communication via event streaming
- Event Queue: Asynchronous message passing between agents
- Artifact: Container for agent response content
- TaskArtifactUpdateEvent: Event type for streaming artifacts



- Architecture: [architecture.md](./architecture.md)
