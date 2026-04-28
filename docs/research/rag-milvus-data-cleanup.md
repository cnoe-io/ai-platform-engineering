# RAG Milvus Data Cleanup Plan

## Problem Statement

When ingestors ingest documents, chunks are written to Milvus but never cleaned up. This leads to:

1. **Orphaned chunks** - When document content shrinks (10 chunks → 5 chunks), chunks 5-9 remain
2. **Deleted source documents** - Old chunks stay in Milvus forever
3. **Abandoned datasources** - If ingestion stops, stale data persists indefinitely

### Current State

| Component | Status |
|-----------|--------|
| `fresh_until` field on all documents | ✅ Stored in Milvus |
| `remove_stale_entities()` for Neo4j | ⚠️ Exists but never called |
| `CLEANUP_INTERVAL` env var (3 hours) | ⚠️ Defined but unused |
| Manual `DELETE /v1/datasource` | ✅ Works |
| `reload_interval` on DataSourceInfo | ⚠️ Stored in metadata, not first-class field |

---

## Implementation Progress

### Completed ✅

| Task | Details |
|------|---------|
| Add `get_fresh_until(reload_interval)` | `common/utils.py` - calculates `now + reload_interval * 1.5` |
| Remove `get_default_fresh_until()` | Backwards compat removed, all callers updated |
| Fix `fresh_until=0` bug in server | `restapi.py` - treats `0` as "use default" |
| Fix test_dummy_graph ingestor | Uses `get_fresh_until(SYNC_INTERVAL)` |
| Fix K8s ingestor | Uses `get_fresh_until(SYNC_INTERVAL)` |
| Fix ArgoCD ingestor | Uses `get_fresh_until(SYNC_INTERVAL)` |
| Fix AWS ingestor | Uses `get_fresh_until(SYNC_INTERVAL)` |
| Fix Backstage ingestor | Uses `get_fresh_until(SYNC_INTERVAL)` |
| Fix GitHub ingestor | Uses `get_fresh_until(SYNC_INTERVAL)` |
| Fix Slack ingestor | Uses `get_fresh_until(sync_interval)` instead of past message timestamp |
| Fix Webex ingestor | Uses `get_fresh_until(sync_interval)` instead of past message timestamp |
| Fix webloader/scrapy_worker | Added `reload_interval` to `CrawlRequest`, uses `get_fresh_until()` |

### In Progress 🔄

| Task | Details |
|------|---------|
| Make `reload_interval` first-class field | Add to `DataSourceInfo` model with migration validator |

### Pending 📋

| Task | Priority | Details |
|------|----------|---------|
| Update ingestors to set `reload_interval` on DataSourceInfo | High | K8s, ArgoCD, AWS, GitHub, Backstage need to set field |
| SearchView: Format `fresh_until` as relative time | Medium | Show "Fresh for 2h" or "Stale 1h ago" |
| IngestView: Add "View Documents" button | Medium | Browse documents within a datasource |
| IngestView: Show "Next reload in X hours" | Medium | Based on `last_updated + reload_interval` |
| Add cleanup endpoints to server | Medium | Per-datasource and bulk cleanup APIs |
| Add periodic cleanup background task | Medium | Automatic stale data removal |
| Consolidate `formatRelativeTime` functions | Low | Move to `lib/utils.ts` |
| Update `remove_stale_entities()` in Neo4j | Low | Support datasource filtering |

---

## Solution Design

### 1. Make `reload_interval` a First-Class Field

**Problem:** Currently `reload_interval` is stored inconsistently:
- Webloader/Confluence: Store in `metadata["reload_interval"]`
- Other ingestors: Don't set it at all (rely on default)

**Solution:** Add `reload_interval` as a first-class field on `DataSourceInfo` with a Pydantic `model_validator` for backwards compatibility.

```python
# common/src/common/models/rag.py

from pydantic import BaseModel, model_validator
from common.constants import DEFAULT_RELOAD_INTERVAL

class DataSourceInfo(BaseModel):
    datasource_id: str
    ingestor_id: str
    description: str
    source_type: str
    last_updated: Optional[int] = None
    default_chunk_size: int = 512
    default_chunk_overlap: int = 50
    reload_interval: int = DEFAULT_RELOAD_INTERVAL  # NEW FIELD
    metadata: Optional[Dict[str, Any]] = None
    
    @model_validator(mode='before')
    @classmethod
    def migrate_reload_interval(cls, values):
        """
        Migration: If reload_interval not in input, check metadata for legacy value.
        This handles existing datasources that stored reload_interval in metadata.
        """
        if values.get('reload_interval') is None:
            metadata = values.get('metadata') or {}
            legacy_value = metadata.get('reload_interval')
            if legacy_value is not None:
                values['reload_interval'] = legacy_value
            # Otherwise field default (DEFAULT_RELOAD_INTERVAL) will be used
        return values
```

**Migration scenarios:**

| Scenario | Input | Result |
|----------|-------|--------|
| New datasource with `reload_interval` | `reload_interval=3600` | 3600 |
| Old datasource with `metadata.reload_interval` | `metadata={"reload_interval": 7200}` | 7200 (migrated) |
| Old datasource without `reload_interval` | `metadata={}` | 86400 (default) |

### 2. Centralized `fresh_until` Calculation

**New function in `common/src/common/utils.py`:**

```python
from common.constants import DEFAULT_RELOAD_INTERVAL

# Buffer factor: fresh_until = now + (reload_interval * FRESH_UNTIL_BUFFER_FACTOR)
FRESH_UNTIL_BUFFER_FACTOR = float(os.getenv("FRESH_UNTIL_BUFFER_FACTOR", "1.5"))

def get_fresh_until(reload_interval: Optional[int] = None) -> int:
    """
    Calculate fresh_until timestamp based on reload interval.
    
    Args:
        reload_interval: Reload interval in seconds. If None, uses DEFAULT_RELOAD_INTERVAL (24h).
    
    Returns:
        Epoch timestamp when data should be considered stale.
        Calculated as: now + (reload_interval * 1.5)
    """
    interval = reload_interval if reload_interval is not None else DEFAULT_RELOAD_INTERVAL
    return int(time.time()) + int(interval * FRESH_UNTIL_BUFFER_FACTOR)

# Keep for backwards compatibility
def get_default_fresh_until() -> int:
    """Deprecated: use get_fresh_until() instead."""
    return get_fresh_until()
```

**Resulting behavior:**

| `reload_interval` | `fresh_until` (1.5x buffer) |
|-------------------|----------------------------|
| 6 hours | 9 hours |
| 24 hours | 36 hours |
| 1 week | 10.5 days |

### 2. Server Fix for `fresh_until=0`

```python
# restapi.py - ingest endpoint
if ingest_request.fresh_until is None or ingest_request.fresh_until == 0:
    reload_interval = datasource_info.metadata.get("reload_interval")
    ingest_request.fresh_until = get_fresh_until(reload_interval)
```

### 3. Cleanup Infrastructure

#### Periodic Background Task

```python
CLEANUP_INTERVAL = int(os.getenv("CLEANUP_INTERVAL", 10800))  # 3 hours
CLEANUP_ENABLED = os.getenv("CLEANUP_ENABLED", "true").lower() == "true"

async def cleanup_stale_data() -> Tuple[int, int]:
    """Delete all stale chunks from Milvus and Neo4j."""
    now = int(time.time())
    
    # Milvus cleanup
    chunks_deleted = await vector_db.adelete(expr=f"fresh_until < {now}")
    
    # Neo4j cleanup (if enabled)
    entities_deleted = 0
    if graph_rag_enabled:
        entities_deleted = await data_graph_db.remove_stale_entities()
    
    return chunks_deleted, entities_deleted

async def periodic_cleanup_task():
    """Background task that runs cleanup periodically."""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL)
        try:
            chunks, entities = await cleanup_stale_data()
            logger.info(f"Periodic cleanup: {chunks} chunks, {entities} entities deleted")
        except Exception as e:
            logger.error(f"Periodic cleanup failed: {e}")
```

#### Per-Datasource Cleanup Endpoint

```
POST /v1/datasource/{datasource_id}/cleanup
```

**Auth:** Admin role required

**Response:**
```json
{
  "datasource_id": "src_https___example_com_abc123",
  "milvus_chunks_deleted": 42,
  "graph_entities_deleted": 15,
  "message": "Cleanup complete"
}
```

**Implementation:**
```python
@app.post("/v1/datasource/{datasource_id}/cleanup")
async def cleanup_datasource(
    datasource_id: str,
    user: UserContext = Depends(require_role(Role.ADMIN))
):
    now = int(time.time())
    
    # Delete stale Milvus chunks for this datasource
    expr = f"datasource_id == '{datasource_id}' and fresh_until < {now}"
    chunks_deleted = await vector_db.adelete(expr=expr)
    
    # Delete stale Neo4j entities for this datasource
    entities_deleted = 0
    if graph_rag_enabled:
        entities_deleted = await data_graph_db.remove_stale_entities(
            datasource_id=datasource_id
        )
    
    return CleanupResponse(
        datasource_id=datasource_id,
        milvus_chunks_deleted=chunks_deleted,
        graph_entities_deleted=entities_deleted,
        message="Cleanup complete"
    )
```

#### Bulk Cleanup Endpoint

```
POST /v1/datasources/cleanup
```

**Auth:** Admin role required

**Response:**
```json
{
  "milvus_chunks_deleted": 1234,
  "graph_entities_deleted": 567,
  "message": "Bulk cleanup complete"
}
```

### 4. Neo4j `remove_stale_entities()` Update

```python
# common/src/common/graph_db/neo4j/graph_db.py

async def remove_stale_entities(self, datasource_id: Optional[str] = None) -> int:
    """
    Remove entities where _fresh_until < now.
    
    Args:
        datasource_id: Optional filter to only clean specific datasource.
    
    Returns:
        Number of entities deleted.
    """
    now = int(time.time())
    
    if datasource_id:
        query = f"""
        MATCH (n:{self.tenant_label}) 
        WHERE n.{FRESH_UNTIL_KEY} < {now} AND n.{DATASOURCE_ID_KEY} = $datasource_id
        DETACH DELETE n
        RETURN count(n) as deleted
        """
        params = {"datasource_id": datasource_id}
    else:
        query = f"""
        MATCH (n:{self.tenant_label}) 
        WHERE n.{FRESH_UNTIL_KEY} < {now}
        DETACH DELETE n
        RETURN count(n) as deleted
        """
        params = {}
    
    async with self.driver.session() as session:
        result = await session.run(query, params)
        record = await result.single()
        return record["deleted"] if record else 0
```

### 5. Ingestor Fixes

#### Slack

```python
# Before (broken)
fresh_until = int(float(newest_ts))

# After
from common.utils import get_fresh_until
fresh_until = get_fresh_until(sync_interval)
```

#### Webex

```python
# Before (broken)
fresh_until = iso_to_timestamp(newest_time) if newest_time else int(time.time())

# After
from common.utils import get_fresh_until
fresh_until = get_fresh_until(sync_interval)
```

### 6. UI Changes

#### 6.1 SearchView: Format `fresh_until` as Relative Time

Currently `fresh_until` displays as a raw Unix timestamp. Update to show human-readable relative time.

```typescript
// ui/src/lib/utils.ts - add new function

import { formatDistanceToNow } from 'date-fns';

/**
 * Format fresh_until timestamp as relative time.
 * Shows "Fresh for X" if in future, "Stale X ago" if in past.
 */
export function formatFreshUntil(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000);
  
  if (timestamp > now) {
    // Future: data is still fresh
    return `Fresh for ${formatDistanceToNow(date)}`;
  } else {
    // Past: data is stale
    return `Stale ${formatDistanceToNow(date, { addSuffix: true })}`;
  }
}

// Examples:
// timestamp = now + 2 hours  → "Fresh for about 2 hours"
// timestamp = now - 30 mins  → "Stale 30 minutes ago"
```

**SearchView.tsx changes:**
```tsx
// In ResultCard metadata display
{key === 'fresh_until' || key === '_fresh_until' ? (
  <span className="font-mono text-foreground">
    {formatFreshUntil(value as number)}
  </span>
) : (
  <span className="font-mono text-foreground break-all">
    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
  </span>
)}
```

#### 6.2 IngestView: "View Documents" Button

Add ability to browse documents within a datasource.

```typescript
// ui/src/lib/rag-api.ts - add function

export async function listDocuments(
  datasourceId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ documents: DocumentMetadata[]; total: number }> {
  // Use search endpoint with datasource filter and empty query
  const response = await searchDocuments({
    query: "",  // Empty query returns all
    datasource_ids: [datasourceId],
    limit: options.limit || 50,
    offset: options.offset || 0,
  });
  return {
    documents: response.results.map(r => r.metadata),
    total: response.total || response.results.length,
  };
}
```

**IngestView.tsx changes:**
- Add "View Documents" button to each datasource row
- Opens modal/drawer showing paginated document list
- Each document shows: title, document_type, fresh_until (formatted), ingested_at

#### 6.3 IngestView: "Next Reload" Indicator

Show when datasource will next reload based on `reload_interval` and `last_updated`.

```typescript
// ui/src/lib/utils.ts - add function

/**
 * Calculate next reload time and format as relative string.
 */
export function formatNextReload(lastUpdated: number, reloadInterval: number): string {
  const nextReload = lastUpdated + reloadInterval;
  const now = Math.floor(Date.now() / 1000);
  const date = new Date(nextReload * 1000);
  
  if (nextReload > now) {
    return `Reloads in ${formatDistanceToNow(date)}`;
  } else {
    return `Overdue by ${formatDistanceToNow(date)}`;
  }
}

// Examples:
// lastUpdated = now - 1h, reloadInterval = 24h → "Reloads in about 23 hours"
// lastUpdated = now - 25h, reloadInterval = 24h → "Overdue by about 1 hour"
```

**IngestView.tsx changes:**
- Show next reload time in datasource row or expanded details
- Use amber color for overdue datasources

#### 6.4 Staleness Indicator

```typescript
const isStale = (ds: DataSourceInfo): boolean => {
  const reloadInterval = ds.reload_interval || DEFAULT_RELOAD_INTERVAL;
  const now = Math.floor(Date.now() / 1000);
  return ds.last_updated !== null && now > ds.last_updated + reloadInterval;
};
```

Display amber "Stale" badge next to datasource name when `isStale(ds)` is true.

#### 6.5 Cleanup Button

- Visible to all users
- Disabled for non-admins (with tooltip "Admin access required")
- Disabled when datasource has no stale data
- Calls `cleanupDatasource(datasource_id)` on click

#### 6.6 Consolidate `formatRelativeTime` Functions

Currently there are 4 duplicate implementations:
- `ConversationCard.tsx` (lines 18-31)
- `RecycleBinDialog.tsx` (lines 51-63)
- `CheckpointStatsSection.tsx` (lines 75-85)
- `IngestView.tsx` (lines 243-245, uses date-fns)

**Consolidate to `ui/src/lib/utils.ts`:**
```typescript
import { formatDistanceToNow } from 'date-fns';

/**
 * Format a date as relative time (e.g., "2h ago", "3 days ago").
 * Uses date-fns for consistent formatting.
 */
export function formatRelativeTime(date: Date | string | number): string {
  let d: Date;
  if (typeof date === 'number') {
    // Unix timestamp in seconds
    d = new Date(date * 1000);
  } else if (typeof date === 'string') {
    d = new Date(date);
  } else {
    d = date;
  }
  return formatDistanceToNow(d, { addSuffix: true });
}
```

---

## Implementation Plan

### Phase 1: Backend - `reload_interval` as First-Class Field ✅ (partially done)

| File | Changes | Status |
|------|---------|--------|
| `common/src/common/utils.py` | Add `get_fresh_until(reload_interval)` | ✅ Done |
| `common/src/common/models/rag.py` | Add `reload_interval` field with migration validator | 🔄 Next |
| `server/src/server/restapi.py` | Fix `fresh_until=0` bug | ✅ Done |

### Phase 2: Ingestor Fixes ✅ Done

| File | Changes | Status |
|------|---------|--------|
| `ingestors/.../slack/ingestor.py` | Use `get_fresh_until(sync_interval)` | ✅ Done |
| `ingestors/.../webex/ingestor.py` | Use `get_fresh_until(sync_interval)` | ✅ Done |
| `ingestors/.../k8s/ingestor.py` | Use `get_fresh_until(SYNC_INTERVAL)` | ✅ Done |
| `ingestors/.../argocdv3/ingestor.py` | Use `get_fresh_until(SYNC_INTERVAL)` | ✅ Done |
| `ingestors/.../aws/ingestor.py` | Use `get_fresh_until(SYNC_INTERVAL)` | ✅ Done |
| `ingestors/.../github/ingestor.py` | Use `get_fresh_until(SYNC_INTERVAL)` | ✅ Done |
| `ingestors/.../backstage/ingestor.py` | Use `get_fresh_until(SYNC_INTERVAL)` | ✅ Done |
| `ingestors/.../test_dummy_graph/ingestor.py` | Use `get_fresh_until(SYNC_INTERVAL)` | ✅ Done |
| `ingestors/.../webloader/.../scrapy_worker.py` | Use `get_fresh_until(reload_interval)` | ✅ Done |

### Phase 3: Ingestors Set `reload_interval` on DataSourceInfo

| File | Changes | Status |
|------|---------|--------|
| All ingestors creating `DataSourceInfo` | Set `reload_interval=SYNC_INTERVAL` | 📋 Pending |

### Phase 4: Cleanup Infrastructure

| File | Changes | Status |
|------|---------|--------|
| `server/src/server/restapi.py` | Add cleanup endpoints, periodic task | 📋 Pending |
| `common/src/common/graph_db/base.py` | Update `remove_stale_entities()` signature | 📋 Pending |
| `common/src/common/graph_db/neo4j/graph_db.py` | Implement filtered stale cleanup | 📋 Pending |

### Phase 5: Frontend UX Improvements

| File | Changes | Status |
|------|---------|--------|
| `ui/src/lib/utils.ts` | Add `formatFreshUntil()`, `formatNextReload()`, consolidate `formatRelativeTime()` | 📋 Pending |
| `ui/src/components/rag/SearchView.tsx` | Format `fresh_until` as relative time | 📋 Pending |
| `ui/src/components/rag/IngestView.tsx` | Add "View Documents" button, "Next reload" indicator, staleness badge | 📋 Pending |
| `ui/src/lib/rag-api.ts` | Add `listDocuments()`, `cleanupDatasource()`, `cleanupAllDatasources()` | 📋 Pending |

---

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `CLEANUP_INTERVAL` | `10800` (3h) | Seconds between periodic cleanups |
| `CLEANUP_ENABLED` | `true` | Set to `false` to disable periodic cleanup |
| `FRESH_UNTIL_BUFFER_FACTOR` | `1.5` | Multiplier for `reload_interval` to calculate `fresh_until` |

---

## API Reference

### `POST /v1/datasource/{datasource_id}/cleanup`

Cleanup stale data for a specific datasource.

**Auth:** Admin role required

**Path Parameters:**
- `datasource_id` (string): The datasource ID to cleanup

**Response:**
```json
{
  "datasource_id": "src_https___example_com_abc123",
  "milvus_chunks_deleted": 42,
  "graph_entities_deleted": 15,
  "message": "Cleanup complete"
}
```

### `POST /v1/datasources/cleanup`

Cleanup all stale data across all datasources.

**Auth:** Admin role required

**Response:**
```json
{
  "milvus_chunks_deleted": 1234,
  "graph_entities_deleted": 567,
  "message": "Bulk cleanup complete"
}
```

---

## View Documents Feature

### Overview

Allow users to browse documents and chunks within a datasource directly in the IngestView expanded row (no modal).

### API Design

#### Endpoint 1: List Documents/Chunks (with pagination)

```
GET /v1/datasource/{datasource_id}/documents?offset=0&limit=100
```

**Query Parameters:**

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `offset` | 0 | - | Number of chunks to skip |
| `limit` | 100 | 1000 | Number of chunks to fetch |

**Constraints:**
- `offset + limit` must be < 16,384 (Milvus query limitation)

**Response:**
```json
{
  "datasource_id": "https://docs.example.com",
  "documents": [
    {
      "document_id": "https://docs.example.com/page1",
      "title": "Getting Started",
      "chunks": [
        {
          "id": "https://docs.example.com/page1_chunk_0",
          "chunk_index": 0,
          "total_chunks": 3,
          "metadata": {
            "fresh_until": 1711584000,
            "document_type": "markdown",
            "document_ingested_at": 1711497600,
            "is_structured_entity": false,
            "source": "https://docs.example.com/page1"
          }
        }
      ]
    }
  ],
  "total_documents": 5,
  "total_chunks": 23,
  "offset": 0,
  "limit": 100,
  "has_more": true
}
```

#### Endpoint 2: Get Chunk Content (on-demand)

```
GET /v1/chunk/{chunk_id}/content
```

**Response:**
```json
{
  "id": "https://docs.example.com/page1_chunk_0",
  "text_content": "# Getting Started\n\nWelcome to..."
}
```

### UI Design

Rendered inside the expanded datasource row, after "Ingestion Jobs" section:

```
│  ▼ Documents                                     42 docs    │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ ▶ Getting Started              3 chunks       Fresh │  │
│    │ ▶ Installation Guide           5 chunks       Stale │  │
│    │ ▶ API Reference               12 chunks       Fresh │  │
│    │                                                     │  │
│    │                    [Load More]                      │  │
│    └─────────────────────────────────────────────────────┘  │
```

Document expanded with chunks:

```
│    │ ▼ Getting Started              3 chunks       Fresh │  │
│    │                                                      │  │
│    │   ▼ chunk 0                                          │  │
│    │     ┌──────────────────────────────────────────────┐ │  │
│    │     │ fresh_until: Fresh for 2 days                │ │  │
│    │     │ document_type: markdown                      │ │  │
│    │     │ ingested_at: 2 hours ago                     │ │  │
│    │     │ is_structured_entity: false                       │ │  │
│    │     │                                              │ │  │
│    │     │ [Chunk content displayed inline when         │ │  │
│    │     │  expanded, loaded on demand]                 │ │  │
│    │     └──────────────────────────────────────────────┘ │  │
│    │                                                      │  │
│    │   ▶ chunk 1                                          │  │
│    │   ▶ chunk 2                                          │  │
```

### Pagination

**Strategy**: Offset-based pagination with "Load More" button

| Config | Value | Rationale |
|--------|-------|-----------|
| Page size | 100 chunks | Balance between responsiveness and API calls |
| Max limit | 1000 chunks/request | Prevent huge responses |
| Milvus constraint | offset + limit < 16,384 | Hard limit in Milvus query API |

**Milvus Query:**
```python
# Fetch limit + 1 to determine if more chunks exist
results = vector_db.client.query(
  collection_name=default_collection_name_docs,
  filter=f"datasource_id == '{datasource_id}'",
  output_fields=["id", "document_id", "title", "chunk_index", ...],
  offset=offset,
  limit=limit + 1,  # Fetch one extra
)

has_more = len(results) > limit
actual_results = results[:limit]
```

**Note**: Milvus `query()` does NOT support `ORDER BY`. Results are returned in insertion order (roughly chronological). Sorting was considered but skipped due to this limitation.

**Edge Cases:**

| Case | Handling |
|------|----------|
| Document spans multiple pages | Merge chunks into existing document by `document_id` |
| User closes/reopens section | Cached data remains, no refetch |
| offset + limit ≥ 16384 | Backend returns 400 error |
| Approaching 16k limit | Show warning badge when offset ≥ 16,000 |

### Chunk Metadata Fields

| Field | Format |
|-------|--------|
| `fresh_until` | "Fresh for X" / "Stale X ago" |
| `document_type` | as-is (e.g., "markdown", "structured:K8sDeployment") |
| `document_ingested_at` | relative time ("2 hours ago") |
| `is_structured_entity` | boolean badge |
| `source` | clickable link (if URL) |
| `structured_entity_type` | show if present |
| `structured_entity_pk` | show if present |

### Behavior

1. **Lazy load** - Fetch documents only when "Documents" section is expanded
2. **Collapsed by default** - Don't add load to the page
3. **[View Content]** - Fetches single chunk content on demand, shows inline

### Files to Modify

| File | Changes |
|------|---------|
| `server/src/server/restapi.py` | Add `GET /v1/datasource/{datasource_id}/documents` and `GET /v1/chunk/{chunk_id}/content` |
| `ui/src/components/rag/api/index.ts` | Add `getDatasourceDocuments()` and `getChunkContent()` |
| `ui/src/components/rag/IngestView.tsx` | Add Documents section inside expanded datasource row |

---

## Testing Considerations

1. **Unit tests for `get_fresh_until()`** - verify buffer factor calculation
2. **Integration tests for cleanup endpoints** - verify Milvus/Neo4j deletion
3. **Test `fresh_until=0` fix** - verify server applies default correctly
4. **Test Slack/Webex ingestors** - verify they set future timestamps
5. **Test periodic cleanup** - verify background task runs and cleans up
