---
sidebar_position: 1
id: 032-mcp-argocd-pagination-summary-architecture
sidebar_label: Architecture
---

# Architecture: ADR: MCP ArgoCD Pagination Implementation

**Date**: 2025-11-05

## Changes Made

### 1. Applications (`api_v1_applications.py`)
**Function**: `list_applications()`

**New Parameters**:
- `page` (int, default=1): Page number (1-indexed)
- `page_size` (int, default=20, max=100): Items per page

**Response Structure**:
```json
{
  "items": [...],  // Only 20 items instead of 819
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total_items": 819,
    "total_pages": 41,
    "has_next": true,
    "has_prev": false,
    "showing_from": 1,
    "showing_to": 20
  },
  "summary_only": true
}
```

### 2. Projects (`api_v1_projects.py`)
**Function**: `project_list()`

**New Parameters**:
- `page` (int, default=1)
- `page_size` (int, default=20, max=100)
- Removed old `limit` parameter

**Same pagination structure as applications**

### 3. Application Sets (`api_v1_applicationsets.py`)
**Function**: `applicationset_list()`

**New Parameters**:
- `page` (int, default=1)
- `page_size` (int, default=20, max=100)

**Same pagination structure as applications**

### 4. Clusters (`api_v1_clusters.py`)
**Function**: `cluster_service__list()`

**New Parameters**:
- `summary_only` (bool, default=True): New addition for clusters
- `page` (int, default=1)
- `page_size` (int, default=20, max=100)

**Same pagination structure as applications**


## Key Features

### Pagination Logic
1. **Page bounds checking**: Returns error if page > total_pages
2. **Page size limits**: Enforces max 100 items per page
3. **Metadata included**: Every response includes pagination info
4. **Zero-based safe**: Handles empty results gracefully

### Benefits
1. **Memory control**: Returns max 100 items instead of 800+
2. **Consistent API**: All list operations use same pagination structure
3. **Client-friendly**: Provides has_next/has_prev for UI navigation
4. **Backward compatible**: Default values maintain similar behavior

### Example Usage

```python
# Get first page (default)
result = await list_applications()
# Returns items 1-20 of 819

# Get second page
result = await list_applications(page=2)
# Returns items 21-40 of 819

# Get more items per page
result = await list_applications(page=1, page_size=50)
# Returns items 1-50 of 819

# Navigate using metadata
if result["pagination"]["has_next"]:
    next_page = result["pagination"]["page"] + 1
    next_result = await list_applications(page=next_page)
```


## Next Steps

1. ✅ Pagination implemented for all list operations
2. ⏳ **TODO**: Implement unified search tool for keyword-based filtering
3. ⏳ **TODO**: Update ArgoCD agent system prompt to use pagination
4. ⏳ **TODO**: Test all endpoints with updated pagination
5. ⏳ **TODO**: Verify OOM is resolved with real workload


## Files Modified

1. `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/api_v1_applications.py`
2. `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/api_v1_projects.py`
3. `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/api_v1_applicationsets.py`
4. `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/api_v1_clusters.py`


## Related

- Spec: [spec.md](./spec.md)
