# Dynamic Agents Conversations $lookup Overflow

**Date:** 2026-04-01  
**Status:** Investigation Complete  
**Severity:** High (blocks page load)

## Problem Statement

Navigating to **Custom Agents > Conversations tab** produces repeated MongoDB errors:

```
MongoServerError: PlanExecutor error during aggregation :: caused by ::
Total size of documents in checkpoints_conversation matching pipeline's
$lookup stage exceeds 104857600 bytes
```

**Error code:** `Location4568` (MongoDB 100MB `$lookup` document limit)  
**Frequency:** Every page load of the Conversations tab (the error repeats 4 times because the UI retries or multiple requests fire concurrently).

---

## Investigation

### Affected Code

**File:** `ui/src/app/api/dynamic-agents/conversations/route.ts` (lines 66-106)  
**Endpoint:** `GET /api/dynamic-agents/conversations`  
**Called by:** `ui/src/components/dynamic-agents/ConversationsTab.tsx` (line 100)

### The Pipeline

The route builds an aggregation pipeline on the `conversations` collection:

```typescript
// route.ts lines 66-106
const pipeline: object[] = [
  { $match: matchStage },
  // --- PROBLEM: unconstrained $lookup ---
  {
    $lookup: {
      from: "checkpoints_conversation",
      localField: "_id",
      foreignField: "thread_id",
      as: "_checkpoints",          // ALL checkpoint docs loaded into array
    },
  },
  {
    $addFields: {
      checkpoint_count: { $size: "$_checkpoints" },
    },
  },
  { $project: { _checkpoints: 0 } },
  // --- pagination happens AFTER the $lookup ---
  {
    $facet: {
      items: [
        { $sort: { updated_at: -1 } },
        { $skip: skip },
        { $limit: pageSize },
        { $project: { /* fields */ } },
      ],
      totalCount: [{ $count: "count" }],
    },
  },
];
```

### Root Cause

Two compounding issues:

1. **Full document materialization for a count** — The `$lookup` joins ALL matching `checkpoints_conversation` documents (which contain serialized LangGraph agent state, tool outputs, and message history) into an in-memory `_checkpoints` array per conversation. It then counts the array with `$size` and immediately discards the data. The only value needed is the count, but the full documents are loaded.

2. **Pagination is applied after the `$lookup`** — The `$facet` with `$skip/$limit` runs after the `$lookup`, meaning the expensive join executes for every conversation in the database, not just the 20 being displayed.

### Why It's Happening Now

The `checkpoints_conversation` collection is populated by `MongoDBSaver` in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py:85-86`. Each LangGraph execution step creates one or more checkpoint documents containing full agent state. Over time, conversations with many agent turns or large tool outputs accumulate checkpoint data exceeding MongoDB's 100MB `$lookup` limit per input document.

A single conversation with heavy usage can trigger the error. Once any conversation's checkpoints exceed 100MB, the entire Conversations tab breaks because the pipeline processes all conversations before paginating.

### Related Collections

| Collection | Written By | Purpose |
|------------|-----------|---------|
| `conversations` | UI Next.js API routes | Conversation metadata (title, owner, agent_id, timestamps) |
| `checkpoints_conversation` | `MongoDBSaver` (Python backend) | LangGraph checkpoint state per execution step |
| `checkpoint_writes_conversation` | `MongoDBSaver` (Python backend) | LangGraph checkpoint write operations |

### Data Flow

```
ConversationsTab.tsx
  -> GET /api/dynamic-agents/conversations  (Next.js route)
    -> MongoDB aggregation on `conversations` collection
      -> $lookup joins ALL docs from `checkpoints_conversation` per conversation
      -> FAILS when any conversation's checkpoints exceed 100MB
```

---

## Recommendation

Combine two changes to fix the issue and improve performance:

### Fix 1: Use a sub-pipeline `$lookup` that only counts (eliminates 100MB limit)

Replace the unconstrained `$lookup` with a sub-pipeline that counts server-side without materializing documents:

```typescript
// BEFORE (broken):
{
  $lookup: {
    from: "checkpoints_conversation",
    localField: "_id",
    foreignField: "thread_id",
    as: "_checkpoints",
  },
},
{
  $addFields: {
    checkpoint_count: { $size: "$_checkpoints" },
  },
},
{ $project: { _checkpoints: 0 } },

// AFTER (fixed):
{
  $lookup: {
    from: "checkpoints_conversation",
    let: { threadId: "$_id" },
    pipeline: [
      { $match: { $expr: { $eq: ["$thread_id", "$$threadId"] } } },
      { $count: "count" },
    ],
    as: "_checkpoints",
  },
},
{
  $addFields: {
    checkpoint_count: {
      $ifNull: [{ $arrayElemAt: ["$_checkpoints.count", 0] }, 0],
    },
  },
},
{ $project: { _checkpoints: 0 } },
```

**Why:** The sub-pipeline never materializes the full checkpoint documents. MongoDB processes the `$count` server-side and only returns a single `{ count: N }` document per conversation. This completely avoids the 100MB limit.

### Fix 2: Move `$lookup` inside `$facet` after pagination (performance)

Restructure the pipeline so the `$lookup` only runs for the paginated page of results (e.g., 20 conversations) instead of all conversations:

```typescript
const pipeline: object[] = [
  { $match: matchStage },
  { $sort: { updated_at: -1 } },
  {
    $facet: {
      items: [
        { $skip: skip },
        { $limit: pageSize },
        // $lookup now only runs for the current page
        {
          $lookup: {
            from: "checkpoints_conversation",
            let: { threadId: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$thread_id", "$$threadId"] } } },
              { $count: "count" },
            ],
            as: "_checkpoints",
          },
        },
        {
          $addFields: {
            checkpoint_count: {
              $ifNull: [{ $arrayElemAt: ["$_checkpoints.count", 0] }, 0],
            },
          },
        },
        {
          $project: {
            _checkpoints: 0,
            id: "$_id",
            title: 1,
            owner_id: 1,
            agent_id: 1,
            created_at: 1,
            updated_at: 1,
            checkpoint_count: 1,
            is_archived: 1,
            deleted_at: 1,
          },
        },
      ],
      totalCount: [{ $count: "count" }],
    },
  },
];
```

**Why:** Even with the sub-pipeline fix, running a `$lookup` for every conversation is unnecessary overhead. Moving it inside the `$facet` after `$skip/$limit` means it only executes for the 20 conversations on the current page.

### Fix 3 (Optional): Verify index on `checkpoints_conversation.thread_id`

`MongoDBSaver` from `langgraph-checkpoint-mongodb` typically creates compound indexes on its collections. Verify that an index exists on `thread_id` in `checkpoints_conversation` to ensure the sub-pipeline `$match` is efficient:

```javascript
// Run in MongoDB shell
db.checkpoints_conversation.getIndexes()
// Should include an index with thread_id as a prefix key
```

If missing:

```javascript
db.checkpoints_conversation.createIndex({ thread_id: 1 })
```

---

## Impact Assessment

| Area | Impact |
|------|--------|
| **Custom Agents > Conversations tab** | Completely broken; page fails to load |
| **Other pages** | Not affected; other `$lookup` usages (audit-logs, stats, users) join different collections with smaller documents |
| **Data integrity** | No risk; this is a read-only query issue |
| **Fix complexity** | Low; single file change in `route.ts` |

---

## Files to Modify

| File | Change |
|------|--------|
| `ui/src/app/api/dynamic-agents/conversations/route.ts` | Rewrite aggregation pipeline (lines 66-106) |

---

## Similar Patterns to Audit

Other `$lookup` usages in the codebase that could hit the same issue at scale:

| File | `$lookup` Target | Risk |
|------|-----------------|------|
| `ui/src/app/api/admin/stats/route.ts:146` | `conversations` (from `messages`) | Medium - conversations are small, but `messages` collection could grow |
| `ui/src/app/api/admin/users/route.ts:41` | `conversations` (from `messages`) | Medium - same concern |
| `ui/src/app/api/admin/audit-logs/route.ts:77` | `messages` (sub-pipeline with `$limit: 1`) | Low - already uses sub-pipeline with limit |
| `ui/src/app/api/admin/audit-logs/export/route.ts:90` | `messages` (sub-pipeline with `$limit: 1`) | Low - same |

The audit-logs routes already follow the correct pattern (sub-pipeline with `$limit`). The stats and users routes should be reviewed if they start failing at scale.
