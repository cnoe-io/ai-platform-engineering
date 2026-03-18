---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-05: ADR: ArgoCD Agent - OOM Protection Strategy"
---

# ADR: ArgoCD Agent - OOM Protection Strategy

**Status**: 🟢 In-use
**Category**: Architecture & Design
**Date**: November 5, 2025
**Signed-off-by**: Sri Aradhyula \<sraradhy@cisco.com\>

## Overview
This document outlines the multi-layered OOM (Out of Memory) protection strategy implemented for the ArgoCD agent to handle large queries safely.


## Motivation
The ArgoCD agent was experiencing OOM crashes when:
- Listing all 819+ applications in a single response
- Processing large JSON payloads (255KB+) from ArgoCD API
- LLM output exceeded 16K token limit, causing stream disconnection and memory accumulation


## Testing & Validation

### Current Test Results ✅

**Pagination Tests (4/4 PASSED)**:
- ✅ Applications: 819 items → Paginated (PAGE 1 of 819)
- ✅ Projects: 236 items → Paginated (PAGE 1 of 236)
- ✅ Application Sets: 287 items → Paginated (PAGE 1 of 287)
- ✅ Clusters: 13 items → All shown (no pagination needed)

**Memory Usage**: ~424 MiB / 4 GiB (10.35%)
**OOMKilled**: `false`
**Container Status**: Stable, running for extended periods

### Stress Test Recommendations

1. **Large Query Test**: Request "list all applications" multiple times in rapid succession
2. **Concurrent Query Test**: Send 5+ queries simultaneously
3. **Memory Leak Test**: Run 100+ queries and monitor memory growth
4. **Edge Case Test**: Search for common terms that match 500+ items

---


## Summary

The ArgoCD agent now has **5 layers of OOM protection**:

1. ✅ **MCP Pagination**: Hard limits at data source (max 100 items/page)
2. ✅ **Search Tool**: Efficient filtering before LLM sees data
3. ✅ **Prompt Engineering**: Guides LLM to summarize and paginate
4. ✅ **Context Management**: Aggressive trimming and compression
5. ✅ **Docker Limits**: Hard 4GB memory cap with graceful handling

**Current Status**:
- Memory: ~10% of 4GB limit
- No OOM events
- All pagination tests passing
- Search tool working correctly

**Recommended Next Steps**:
1. Add max search result limits (Layer 6)
2. Add response size monitoring (observability)
3. Implement stress testing suite
4. Set up Prometheus/Grafana monitoring

---


## Related Files

- MCP Tools: `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/`
- Agent Prompt: `ai_platform_engineering/agents/argocd/agent_argocd/protocol_bindings/a2a_server/agent.py`
- Context Management: `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py`
- Docker Config: `docker-compose.dev.yaml`
- Search Tool: `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/search.py`



## Related

- Architecture: [architecture.md](./architecture.md)
