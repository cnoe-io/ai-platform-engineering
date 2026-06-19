# Audit Log Backend Performance

**Audience:** Platform operators and contributors evaluating audit log storage options.

Two performance improvements shipped together in [#1903](https://github.com/cnoe-io/ai-platform-engineering/issues/1903):

1. **Pluggable audit backend** — MongoDB writes replaced by local-disk or S3
2. **OpenFGA N+1 fix** — sequential permission checks on `/api/rbac/admin-tab-gates` parallelized

---

## Benchmark Setup

| Parameter | Value |
|-----------|-------|
| Tool | [Locust](https://locust.io) |
| Concurrent users | 20 |
| Ramp rate | 5 users/s |
| Duration | 60 s |
| Host | `http://localhost:3000` (Docker, production image) |
| Endpoints sampled | `auth/session`, `chat/conversations`, `rbac/admin-tab-gates`, `admin/stats`, `dynamic-agents/available`, `admin/platform-config` |

Three runs on the same machine, back-to-back, changing only `AUDIT_LOG_BACKEND`:

| Run | Branch | Audit backend |
|-----|--------|---------------|
| Baseline | `main` | MongoDB (legacy) |
| After-local | PR #1917 | `local` (NDJSON on disk) |
| After-S3 | PR #1917 | `s3` (buffered Parquet) |

---

## Results: `/api/rbac/admin-tab-gates`

This endpoint is the most latency-sensitive — it gates every Admin tab open.

| Backend | p50 | p75 | p95 | p99 | p100 |
|---------|-----|-----|-----|-----|------|
| MongoDB (before) | 170 ms | 190 ms | 390 ms | 760 ms | 770 ms |
| Local file (after) | 130 ms | 150 ms | 230 ms | 350 ms | 350 ms |
| S3 (after) | 130 ms | 140 ms | 170 ms | 220 ms | 240 ms |

**p50 improvement: −24%** (170 ms → 130 ms).
**p99 improvement: −54% / −71%** (local / S3 vs MongoDB).

---

## What drove the improvement

### 1. Audit backend: removed synchronous MongoDB write from the hot path

The legacy path called `db.collection("audit_logs").insertOne(event)` inline in every API handler and **awaited** the result before returning the response. Under load, MongoDB connection-pool contention added 30–50 ms to the median and caused the long tail (760 ms p99).

Both new backends write **fire-and-forget** — the handler returns immediately, the write happens asynchronously:

- **`local`** — appends one NDJSON line to a date-partitioned file under `AUDIT_LOG_LOCAL_PATH`. Uses a per-backend `threading.Lock` (Python) / in-process queue (TypeScript) so concurrent requests never interleave partial writes.
- **`s3`** — buffers events in memory; flushes as a single Parquet object (Python) or gzip-NDJSON object (TypeScript) when the buffer reaches 100 events or 60 seconds, whichever comes first. The flush runs on a background timer thread / `setInterval` and never blocks a request.

### 2. OpenFGA N+1: parallelized 18 sequential permission checks

`GET /api/rbac/admin-tab-gates` checks one OpenFGA tuple per admin tab. Before the fix, each check was `await`-ed inside a `for` loop:

```ts
// before — 18 sequential round-trips to OpenFGA
for (const tab of ALL_TABS) {
  const allowed = await checkOpenFgaTuple({ user, relation, object });
  gates[tab] = allowed;
}
```

With 18 tabs and ~7 ms per local OpenFGA call, this alone accounts for ~126 ms of the 130 ms p50.

After the fix, all tab checks and the baseline-repair write run in a single `Promise.all`:

```ts
// after — all checks in parallel, repair concurrent
async function evaluateTab(tab: AdminTabKey): Promise<boolean> { ... }

const [tabResults] = await Promise.all([
  Promise.all(ALL_TABS.map(evaluateTab)),
  repairCurrentUserBaseline(currentSubject, isAdmin),
]);
```

Wall-clock cost drops from `18 × RTT` to `1 × RTT` (the slowest single check).

---

## Remaining latency

The 130 ms p50 after the fix is almost entirely the **slowest single OpenFGA check** in the parallel batch — dominated by `hasAccessibleSlackChannel` / `hasAccessibleWebexSpace`, which each do a MongoDB query plus per-row OpenFGA checks in a sequential loop. For deployments with many Slack channels or Webex spaces, those functions are the next optimization target.

---

## Backend selection guide

| Environment | Recommended backend | Reason |
|-------------|---------------------|--------|
| Local development | `local` | Zero config, immediately readable NDJSON files |
| Single-node staging | `local` | No external dependencies |
| Multi-replica Kubernetes | `s3` | All pods write to the same bucket; survives pod restarts |
| Air-gapped / on-prem | `local` | S3 not available |

Set `AUDIT_LOG_BACKEND=local` (default) or `AUDIT_LOG_BACKEND=s3` in your environment.
See [Audit Log Storage Configuration](../../../installation/audit-log-storage.md) for the full variable reference.

---

## Full benchmark data

All endpoints, 60-second run, 20 concurrent users:

### Baseline — MongoDB

| Endpoint | p50 | p95 | p99 |
|----------|-----|-----|-----|
| `/api/auth/session` | 4 ms | 18 ms | 62 ms |
| `/api/chat/conversations` (list) | 8 ms | 27 ms | 110 ms |
| `/api/admin/stats` | 26 ms | 190 ms | 410 ms |
| `/api/dynamic-agents/available` | 39 ms | 230 ms | 310 ms |
| `/api/rbac/admin-tab-gates` | **170 ms** | **390 ms** | **760 ms** |

### After — local file backend

| Endpoint | p50 | p95 | p99 |
|----------|-----|-----|-----|
| `/api/auth/session` | 5 ms | 15 ms | 23 ms |
| `/api/chat/conversations` (list) | 8 ms | 32 ms | 87 ms |
| `/api/admin/stats` | 21 ms | 61 ms | 170 ms |
| `/api/dynamic-agents/available` | 34 ms | 73 ms | 260 ms |
| `/api/rbac/admin-tab-gates` | **130 ms** | **230 ms** | **350 ms** |

### After — S3 backend

| Endpoint | p50 | p95 | p99 |
|----------|-----|-----|-----|
| `/api/auth/session` | 5 ms | 14 ms | 52 ms |
| `/api/chat/conversations` (list) | 8 ms | 27 ms | 100 ms |
| `/api/admin/stats` | 20 ms | 51 ms | 130 ms |
| `/api/dynamic-agents/available` | 27 ms | 70 ms | 88 ms |
| `/api/rbac/admin-tab-gates` | **130 ms** | **170 ms** | **220 ms** |
