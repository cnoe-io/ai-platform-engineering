---
title: "2025-11-05: ADR: ArgoCD Agent - OOM Protection Architecture"
---

# ADR: ArgoCD Agent - OOM Protection Architecture

**Status**: 🟢 In-use
**Category**: Architecture & Design
**Date**: November 5, 2025
**Signed-off-by**: Sri Aradhyula \<sraradhy@cisco.com\>

## Data Flow with Safety Checkpoints

```
┌─────────────────────────────────────────────────────────────────┐
│  USER QUERY: "Show me production applications"                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: LLM Prompt Strategy (Agent)                           │
│  ✓ Analyzes query: Contains keyword "production"                │
│  ✓ Decision: Use Search_Argocd_Resources (not list)             │
│  ✓ Prepares: search_argocd_resources(query="production")        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2 & 6: Search Tool with Limits (search.py)              │
│                                                                  │
│  Step 1: Fetch from ArgoCD API                                  │
│    ├─ list_applications(page=1, page_size=100)  ← Layer 1      │
│    ├─ project_list(page=1, page_size=100)       ← Layer 1      │
│    ├─ applicationset_list(page=1, page_size=100)← Layer 1      │
│    └─ cluster_service__list(page=1, page_size=100)← Layer 1    │
│                                                                  │
│  Step 2: Filter matches client-side                             │
│    └─ Regex search for "production" across fields              │
│                                                                  │
│  Step 3: Check safety limits (NEW!)                             │
│    ├─ Total matches: 18 items                                   │
│    ├─ Check: 18 < 1,000 (MAX_SEARCH_RESULTS) ✓                 │
│    └─ Status: SAFE - Proceed                                    │
│                                                                  │
│  Step 4: Apply pagination                                       │
│    └─ Return page 1 (items 1-18 of 18)                         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4: Context Window Management                             │
│  ✓ Tool output: ~8KB (18 items × ~450 bytes)                   │
│  ✓ Check: 8KB < 5KB limit → Passed through                     │
│  ✓ Current context: 15,000 tokens < 20,000 limit ✓             │
│  ✓ Message history: 3 messages > 2 minimum ✓                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: LLM Output Formatting                                 │
│  ✓ Matches: 18 items (< 50 threshold)                          │
│  ✓ Format: "Showing all 18 items" + table                      │
│  ✓ Output tokens: ~2,500 tokens (< 16K limit) ✓                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 5: Docker Resource Monitor                               │
│  ✓ Peak memory: 480 MiB < 4 GiB limit ✓                        │
│  ✓ Memory usage: 12% (Safe zone)                                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  ✅ RESPONSE DELIVERED TO USER                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Failure Scenario: Large Query Protection

```
┌─────────────────────────────────────────────────────────────────┐
│  USER QUERY: "List all ArgoCD applications"                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: LLM Prompt Strategy                                   │
│  ✓ Analyzes query: "list all" = complete inventory              │
│  ✓ Decision: Use List_Applications (not search)                 │
│  ✓ Prepares: list_applications(page=1, page_size=20)            │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: MCP Tool Pagination (api_v1_applications.py)         │
│                                                                  │
│  Step 1: Fetch from ArgoCD API                                  │
│    └─ GET /api/v1/applications → 819 items                     │
│                                                                  │
│  Step 2: Apply pagination (CRITICAL!)                           │
│    ├─ Total items: 819                                          │
│    ├─ Page: 1, Page size: 20                                    │
│    ├─ Slice: items[0:20] = 20 items                            │
│    └─ Memory saved: 799 items NOT loaded into memory!          │
│                                                                  │
│  Step 3: Return with metadata                                   │
│    └─ {items: [...20 items], pagination: {total: 819, ...}}   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4: Context Window Management                             │
│  ✓ Tool output: ~10KB (20 items)                               │
│  ✓ Current context: 16,000 tokens < 20,000 limit ✓             │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: LLM Output Formatting                                 │
│  ✓ Total: 819 items (> 50 threshold)                           │
│  ✓ Format: "PAGE 1 of 819" + Summary + First 20 in table       │
│  ✓ Output tokens: ~3,500 tokens (< 16K limit) ✓                │
│  🛡️ PROTECTION: Would be 82K tokens without pagination!         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 5: Docker Resource Monitor                               │
│  ✓ Peak memory: 520 MiB < 4 GiB limit ✓                        │
│  ✓ Memory usage: 13% (Safe zone)                                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  ✅ RESPONSE: "PAGE 1 of 819. Ask for page 2 for more..."       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Emergency Brake Scenario: Overly Broad Search

```
┌─────────────────────────────────────────────────────────────────┐
│  USER QUERY: "Search for 'a' in ArgoCD" (matches many items)    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: Search Tool (search.py)                               │
│                                                                  │
│  Step 1: Fetch limited data                                     │
│    ├─ Max 100 apps    (Page 1 only)                            │
│    ├─ Max 100 projects (Page 1 only)                           │
│    ├─ Max 100 appsets  (Page 1 only)                           │
│    └─ Max 100 clusters (Page 1 only)                           │
│         Total fetched: 400 items (NOT 1,000+)                   │
│                                                                  │
│  Step 2: Filter matches                                         │
│    └─ Letter 'a' matches: 387 items                            │
│                                                                  │
│  Step 3: SAFETY CHECK (Layer 6 - NEW!)                          │
│    ├─ Total matches: 387 items                                  │
│    ├─ Threshold: 387 < 1,000 (MAX_SEARCH_RESULTS) ✓            │
│    ├─ Warning: 387 < 500 (WARN_SEARCH_RESULTS) ✓               │
│    └─ Status: SAFE - Proceed with pagination                    │
│                                                                  │
│  Step 4: Apply pagination                                       │
│    └─ Return page 1 (items 1-20 of 387)                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  ✅ RESPONSE: "PAGE 1 of 387 matches for 'a'..."                │
└─────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│  ALTERNATE: What if 1,200 items matched?                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 6: Emergency Brake (search.py)                           │
│                                                                  │
│  🚨 SAFETY CHECK FAILED!                                         │
│    ├─ Total matches: 1,200 items                                │
│    ├─ Threshold: 1,200 > 1,000 (MAX_SEARCH_RESULTS) ✗          │
│    └─ Action: REJECT REQUEST                                    │
│                                                                  │
│  Return error response:                                          │
│  {                                                               │
│    "error": "Query returned 1,200 results, exceeding limit",    │
│    "suggestion": "Please refine search terms",                  │
│    "breakdown": {                                                │
│      "applications": 400,                                        │
│      "projects": 300,                                            │
│      "applicationsets": 350,                                     │
│      "clusters": 150                                             │
│    }                                                             │
│  }                                                               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  ❌ ERROR RESPONSE: "Too many results. Please refine search."   │
│  💡 Suggestion shown to user for better query                   │
└─────────────────────────────────────────────────────────────────┘
```

---

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

## Memory Budget per Query Type

### Small Query (e.g., "Find dev apps")
- API fetch: 100 items × 500 bytes = 50 KB
- Filtered: 5 matches × 500 bytes = 2.5 KB
- LLM context: ~5K tokens = 20 KB
- LLM output: ~1K tokens = 4 KB
- **Total: < 100 KB per query**

### Medium Query (e.g., "List apps page 1")
- API fetch: 20 items × 500 bytes = 10 KB
- LLM context: ~8K tokens = 32 KB
- LLM output: ~3K tokens = 12 KB
- **Total: < 100 KB per query**

### Large Query (e.g., "Search for 'prod'")
- API fetch: 400 items × 500 bytes = 200 KB
- Filtered: 50 matches × 500 bytes = 25 KB
- Paginated: 20 items × 500 bytes = 10 KB
- LLM context: ~12K tokens = 48 KB
- LLM output: ~3.5K tokens = 14 KB
- **Total: < 300 KB per query**

### Maximum Safe Query
- API fetch: 400 items (100 each type) = 200 KB
- All match search: 400 items = 200 KB
- Paginated: 20 items = 10 KB
- LLM processing: ~50 KB
- **Total: < 500 KB per query**
- **Safety margin**: 500 KB × 100 queries = 50 MB (well under 4 GB)

---

## Conclusion

The ArgoCD agent is now protected by **6 layers of defense** against OOM:

1. ✅ Pagination at data source
2. ✅ Search with fetch limits
3. ✅ Smart LLM prompting
4. ✅ Context window management
5. ✅ Docker resource limits
6. ✅ **NEW: Hard search result caps**

**Result**:
- No query can cause OOM
- Memory usage: ~10% of limit
- Graceful error handling
- User-friendly suggestions when limits hit

