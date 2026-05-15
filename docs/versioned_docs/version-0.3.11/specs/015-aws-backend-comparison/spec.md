---
sidebar_position: 2
sidebar_label: Specification
title: "2025-10-27: AWS Agent Backend Implementations"
---

# AWS Agent Backend Implementations

**Status**: 🟢 In-use (Part of consolidated AWS integration)
**Category**: Integrations
**Date**: October 27, 2025 (Consolidated into 2025-11-05-aws-integration.md)

The AWS agent supports two backend implementations:

## Testing Both Implementations

### Test LangGraph Backend (Default):
```bash
curl -X POST http://localhost:8002 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"id":"test","method":"message/stream","params":{"message":{"role":"user","parts":[{"kind":"text","text":"list EKS clusters"}]}}}'

# Look for tool notifications:
# 🔧 Aws: Calling tool: ...
# ✅ Aws: Tool ... completed
```

### Test Strands Backend:
```bash
export AWS_AGENT_BACKEND=strands
# Restart agent
docker-compose -f docker-compose.dev.yaml restart agent-aws-p2p

curl -X POST http://localhost:8002 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"id":"test","method":"message/stream","params":{"message":{"role":"user","parts":[{"kind":"text","text":"list EKS clusters"}]}}}'

# No tool notifications, just chunked content
```









## Related

- Architecture: [architecture.md](./architecture.md)
