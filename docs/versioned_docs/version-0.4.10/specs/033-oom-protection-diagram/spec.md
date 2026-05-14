---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-05: ADR: ArgoCD Agent - OOM Protection Architecture"
---

# ADR: ArgoCD Agent - OOM Protection Architecture

**Status**: 🟢 In-use
**Category**: Architecture & Design
**Date**: November 5, 2025
**Signed-off-by**: Sri Aradhyula \<sraradhy@cisco.com\>

## Protection Layer Summary

| Layer | Location | Limit | What It Protects |
|-------|----------|-------|------------------|
| **1. MCP Pagination** | `tools/api_v1_*.py` | 20 default, 100 max per page | API fetch size, prevents loading all data |
| **2. Search Tool** | `tools/search.py` | 100 items per type | Fetch size, client-side filtering |
| **6. Search Limits** | `tools/search.py` | 1,000 total matches | Total results, rejects overly broad queries |
| **3. LLM Prompt** | `agent.py` | Prefer search, paginate >50 | LLM decision making, output formatting |
| **4. Context Mgmt** | `base_langgraph_agent.py` | 20K tokens, 5KB outputs | Context window, conversation history |
| **5. Docker Limits** | `docker-compose.dev.yaml` | 4GB hard limit | Container memory, system stability |

---


## Related

- Architecture: [architecture.md](./architecture.md)
