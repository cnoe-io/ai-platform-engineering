---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-05: ADR: MCP ArgoCD Pagination Implementation"
---

# ADR: MCP ArgoCD Pagination Implementation

**Status**: 🟢 In-use
**Category**: Features & Enhancements
**Date**: November 5, 2025
**Signed-off-by**: Sri Aradhyula \<sraradhy@cisco.com\>

## Summary

Implemented strict pagination for all ArgoCD MCP list operations to prevent OOM issues caused by large responses (e.g., 819 applications = 255KB JSON).


## Impact on OOM Issue

### Before Pagination
- **Request**: "List ALL ArgoCD applications"
- **Response**: 819 apps × ~300 bytes = **~255KB** in single tool output
- **Problem**: This gets stored in LangGraph message history
- **Result**: Context explodes to 460K+ tokens → OOM kill

### After Pagination
- **Request**: "List ALL ArgoCD applications" (page defaults to 1)
- **Response**: 20 apps × ~300 bytes = **~6KB** in single tool output
- **Context size**: Reduced by **97%**
- **Result**: Stays well within 20K token limit → **No OOM**


## Testing Required

Need to restart MCP server and test:
```bash
# Restart MCP ArgoCD server
docker compose -f docker-compose.dev.yaml --profile=p2p-no-rag restart mcp-argocd agent-argocd-p2p

# Test pagination
curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -d '{"message": "List applications page 1"}'
```



## Related

- Architecture: [architecture.md](./architecture.md)
