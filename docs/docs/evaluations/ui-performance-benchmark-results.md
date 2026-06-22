# UI Performance Benchmark Results

**Audience:** Contributors deciding which UI performance changes to keep.

**Branch:** `prebuild/feat/audit-log-configurable-backend`

**Recorded:** June 20, 2026

This page captures the benchmark runs from the audit-service and UI performance work.
Use the clean 300-user before/after run as the primary decision data. The exploratory
runs are useful directionally, but they compare different runtime shapes.

---

## Summary

| Change set | Best evidence | Result |
|------------|---------------|--------|
| Short-TTL server response cache | Clean 300-user local production run | RPS 261.6 -> 2355.4, p95 2405.6 ms -> 354.7 ms |
| MongoDB connection single-flight, pool tuning, hot indexes | Clean 300-user local production run | Chat list p95 1660.7 ms -> 405.7 ms |
| JWT/API error log reduction | Clean 300-user local production run | Missing-chat error path p95 767.6 ms -> 217.5 ms |
| Audit-service offload | Audit/RBAC benchmark | Removes UI storage ownership; audit writes become non-blocking |
| OpenFGA BatchCheck | Audit/RBAC benchmark | `admin-tab-gates` p50 200 ms -> 46 ms at 300 users |

Primary recommendation:

- Keep the route cache, MongoDB connection/index changes, and log reduction.
- Keep audit storage outside the UI. The UI should emit audit events and tolerate audit-service outages.
- Re-run the clean benchmark in the final `caipe-ui-prod` container before release if container parity is required.

---

## Clean 300-User UI Benchmark

This is the most comparable before/after run for the latest UI optimizations.

### Runtime

| Item | Value |
|------|-------|
| UI server | Local production `next start` on `http://localhost:3005` |
| Dependencies | Existing Docker Compose services from `docker-compose.dev.yaml` |
| Auth | Keycloak `caipe-platform` service-account bearer token |
| Audit | `AUDIT_LOG_BACKEND=off` |
| Users | 300 virtual HTTP users |
| Duration | 30 seconds |
| Failure count | 0 before, 0 after |

Environment notes:

- `MONGODB_URI=mongodb://admin:changeme@localhost:27017/caipe?authSource=admin`
- `OPENFGA_HTTP=http://127.0.0.1:18080`
- `KEYCLOAK_URL=http://127.0.0.1:7080`
- `RAG_SERVER_URL=http://127.0.0.1:9446`
- `AGENTGATEWAY_ADMIN_CONFIG_URL=http://127.0.0.1:15000/config`
- `DYNAMIC_AGENTS_URL=http://127.0.0.1:8100`

### Workload

| Endpoint | Weight | Expected status |
|----------|--------|-----------------|
| `/api/chat/conversations?page=1&page_size=20&client_type=webui` | 5 | 200 |
| `/api/chat/conversations/000000000000000000000000` | 1 | 400 or 404 |
| `/api/auth/session` | 4 | 200 |
| `/api/dynamic-agents/available` | 3 | 200 |
| `/api/admin/stats` | 2 | 200 |
| `/api/admin/platform-config` | 1 | 403 |
| `/api/platform/health` | 1 | 200 or 503 |

Important caveats:

- `/api/rbac/admin-tab-gates` is cookie-session only, so it was not load-tested in this bearer-token harness.
- `/api/platform/health` returned 503 because some local host-mapped dependency checks failed. The latency and cache behavior are still useful.
- `/api/admin/platform-config` returned 403 for the service account. This measures the forbidden path, not the authorized success path.
- The synthetic conversation id is intentionally malformed and exercises the error path.

### Overall result

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total requests | 8,176 | 70,904 | +767% |
| RPS | 261.6 | 2355.4 | +800% |
| Avg latency | 1129.7 ms | 127.0 ms | -88.8% |
| p50 | 1269.5 ms | 34.6 ms | -97.3% |
| p90 | 2175.5 ms | 306.9 ms | -85.9% |
| p95 | 2405.6 ms | 354.7 ms | -85.3% |
| p99 | 2750.8 ms | 463.4 ms | -83.2% |
| Max | 2944.3 ms | 4644.9 ms | Higher outlier during heavier throughput |

### Endpoint result

| Endpoint | Before p50 | Before p95 | After p50 | After p95 | Notes |
|----------|------------|------------|-----------|-----------|-------|
| Chat list | 1270.2 ms | 1660.7 ms | 277.3 ms | 405.7 ms | Mongo pool/index changes helped the hot read path |
| Missing chat | 424.2 ms | 767.6 ms | 142.4 ms | 217.5 ms | Less 4xx stack logging on the error path |
| Auth session | 3.5 ms | 17.2 ms | 22.3 ms | 45.6 ms | Still sub-50 ms p95 while serving 9x RPS |
| Dynamic agents available | 2154.3 ms | 2752.4 ms | 22.7 ms | 53.8 ms | Short-TTL response cache |
| Admin stats | 1731.0 ms | 2210.2 ms | 22.2 ms | 48.0 ms | Short-TTL response cache |
| Platform config forbidden | 439.2 ms | 721.0 ms | 85.8 ms | 172.7 ms | Forbidden path only |
| Platform health | 1679.8 ms | 2166.5 ms | 24.1 ms | 373.6 ms | Short-TTL cache, local setup returned 503 |

### Cache behavior

| Endpoint | Hits | Misses | Shared in-flight | Hit rate |
|----------|------|--------|------------------|----------|
| Dynamic agents available | 12,139 | 3 | 342 | 97.2% |
| Admin stats | 8,266 | 2 | 117 | 98.6% |
| Platform health | 3,693 | 6 | 441 | 89.2% |

`shared` means multiple requests joined one in-flight upstream fetch instead of starting duplicate work.

### Tunables added

| Env var | Default | Purpose |
|---------|---------|---------|
| `PLATFORM_HEALTH_CACHE_TTL_MS` | `5000` | Cache health responses, including 503 |
| `DYNAMIC_AGENTS_AVAILABLE_CACHE_TTL_MS` | `10000` | Cache dynamic agent discovery |
| `ADMIN_STATS_CACHE_TTL_MS` | `15000` | Cache admin dashboard stats |
| `PLATFORM_CONFIG_CACHE_TTL_MS` | `10000` | Cache platform config GETs; PATCH clears cache |
| `ADMIN_TAB_GATES_CACHE_TTL_MS` | `10000` | Cache admin tab gates per user |
| `MONGODB_MAX_POOL_SIZE` | `50` | Increase UI MongoDB pool headroom |
| `MONGODB_MIN_POOL_SIZE` | `2` | Keep warm MongoDB connections |
| `AUTH_JWT_DEBUG` | unset | Opt in to successful JWT validation logs |
| `API_ERROR_LOG_4XX` | unset | Opt in to 4xx stack logging |

---

## Exploratory 300-User Branch Comparison

This run compared the existing Docker container on port 3000 with the branch
running locally on port 3005. Treat it as directional because the runtime shape
was not identical.

### Overall

| Metric | Before container | Branch local production |
|--------|------------------|-------------------------|
| Users | 300 | 300 |
| Total requests | 8,761 | 10,378 |
| Failures | 483 | 0 |
| RPS | 186.1 | 220.9 |
| Avg latency | 295.3 ms | 59.4 ms |
| p50 | 108.2 ms | 9.9 ms |
| p90 | 843.0 ms | 51.9 ms |
| p95 | 1183.6 ms | 101.6 ms |
| p99 | 1758.5 ms | 1735.2 ms |
| Max | 1975.4 ms | 2440.5 ms |

The 483 baseline failures were from the synthetic fake-conversation status handling in the harness.

### Endpoint p95

| Endpoint | Before container p95 | Branch p95 |
|----------|----------------------|------------|
| Chat list | 1102.2 ms | 105.9 ms |
| Fake chat get | 445.1 ms | 94.1 ms |
| Auth session | 79.0 ms | 15.9 ms |
| Admin tab gates | 182.9 ms | 55.5 ms |
| Admin stats | 1664.3 ms | 160.7 ms |
| Dynamic agents available | 1751.5 ms | 144.4 ms |
| Platform config | 863.8 ms | 79.7 ms |
| Platform health | 1672.6 ms | 163.0 ms |

---

## Route and API Smoke Benchmark

This smaller run used 10 browser route iterations and 40 API samples. It compared
the Docker baseline with the local production branch, so use it as smoke-test data.

Client route transitions stayed in the same range, roughly 25-34 ms. The larger gain
was on API latency.

| Endpoint | Before p50 | Before p95 | Branch p50 | Branch p95 |
|----------|------------|------------|------------|------------|
| `/api/rbac/admin-tab-gates` | 18.3 ms | 30.3 ms | 9.1 ms | 20.2 ms |
| `/api/admin/stats` | 16.4 ms | 29.1 ms | 12.0 ms | 21.8 ms |
| `/api/dynamic-agents/available` | 24.3 ms | 41.3 ms | 15.2 ms | 18.5 ms |
| `/api/admin/platform-config` | 13.6 ms | 24.0 ms | 6.5 ms | 10.5 ms |
| `/api/auth/session` | 4.5 ms | 7.2 ms | 2.7 ms | 4.3 ms |

---

## Audit and RBAC Benchmark Summary

Full audit/RBAC data lives in [Audit Log Backend Performance](../security/rbac/audit-log-performance.md).

### Admin tab gates, 20 users

| Strategy | p50 | p75 | p95 | p99 |
|----------|-----|-----|-----|-----|
| MongoDB audit + sequential OpenFGA | 170 ms | 190 ms | 390 ms | 760 ms |
| Local audit-service + `Promise.all` | 130 ms | 150 ms | 230 ms | 350 ms |
| S3 audit-service + `Promise.all` | 130 ms | 140 ms | 170 ms | 220 ms |

### Admin tab gates, 300 users

| Strategy | p50 | p75 | p95 | p99 |
|----------|-----|-----|-----|-----|
| 18 parallel RPCs with `Promise.all` | 200 ms | 310 ms | 800 ms | 960 ms |
| OpenFGA BatchCheck single RPC | 46 ms | 93 ms | 450 ms | 780 ms |

### 300 users, all endpoints

| Endpoint | S3 + `Promise.all` p95 | S3 + BatchCheck p95 |
|----------|------------------------|---------------------|
| `/api/auth/session` | 48 ms | 53 ms |
| `/api/chat/conversations` | 190 ms | 400 ms |
| `/api/admin/stats` | 400 ms | 650 ms |
| `/api/dynamic-agents/available` | 400 ms | 640 ms |
| `/api/rbac/admin-tab-gates` | 800 ms | 450 ms |

Interpretation:

- BatchCheck is a clear win for the admin gate critical path.
- The non-RBAC endpoints became the next bottleneck at 300 users.
- The later short-TTL route cache directly targets those non-RBAC endpoints.

---

## Commit Decision Notes

| Change | Keep? | Why |
|--------|-------|-----|
| Audit-service owns local and S3 storage | Yes | Keeps UI storage-free and makes audit non-critical-path |
| Drop audit events when service is down | Yes | Matches product behavior: warn in health, do not break navigation |
| OpenFGA BatchCheck | Yes | Largest RBAC-specific improvement under 300 users |
| Route response cache | Yes | Largest overall 300-user UI improvement |
| MongoDB pool/index/single-flight changes | Yes | Improves chat list and reduces startup/index churn |
| JWT success log opt-in | Yes | Removes high-volume success logs under load |
| 4xx stack log opt-in | Yes | Keeps expected client errors from becoming a throughput problem |

Release validation still needed:

- Re-run the clean 300-user benchmark against the final `caipe-ui-prod` image.
- Add a cookie-auth load harness for `/api/rbac/admin-tab-gates`.
- Measure authorized `/api/admin/platform-config` success path.
- Confirm production TTL defaults are acceptable for admin freshness.

---

## Docker Compose 1000-User S3 Run

This run validates the branch in `docker-compose.dev.yaml` with the UI sending
audit events to `audit-service`, and `audit-service` writing Parquet to S3.

Runtime:

| Item | Value |
|------|-------|
| Compose file | `docker-compose.dev.yaml` |
| UI image | `ghcr.io/cnoe-io/caipe-ui:branch-s3-perf-prod` |
| Audit image | `ghcr.io/cnoe-io/caipe-audit-service:branch-s3-perf` |
| Audit mode | `AUDIT_LOG_BACKEND=service` |
| Audit service backend | `AUDIT_SERVICE_BACKEND=s3` |
| Users | 1,000 virtual HTTP users |
| Spawn rate | 100 users/sec |
| Duration | 60 seconds |
| Report | `reports/1000u-branch-s3-compose-prod-20260620-001905.html` |

Build caveat:

- The UI container was a branch runner image built from local
  `next build` standalone output because the standard Dockerfile `npm ci`
  layer stalled on this workstation.
- Re-run with the official Dockerfile path before release sign-off.

Audit-service health after the paired 1000-user runs:

| Metric | Value |
|--------|-------|
| Backend | `s3` |
| Queue size | 0 |
| Accepted events | 17,228 |
| Flushed events | 17,228 |
| Rejected events | 0 |
| Failed flushes | 0 |

Container samples during the 60-second API run:

| Container | Avg CPU | Max CPU | Last memory sample |
|-----------|---------|---------|--------------------|
| `caipe-ui-prod` | 113.0% | 139.86% | 827.5 MiB |
| `audit-service` | 5.5% | 27.34% | 122.3 MiB |

Interpretation:

- S3 audit writes worked and drained fully.
- `audit-service` was not the CPU bottleneck.
- The full compose stack still shows high UI/API tail latency at 1,000 users.
- Compare this only against other compose-container runs, not the faster local
  `next start` run on port 3005.

### 1000-user API result

The only recorded failures are the expected synthetic fake-conversation `400`
responses from `/api/chat/conversations [get]`.

| Metric | Old compose image | Branch compose + S3 |
|--------|-------------------|---------------------|
| Requests | 14,054 | 16,662 |
| Expected fake-get failures | 840 | 947 |
| Other failures | 0 | 0 |
| RPS | 237.5 | 276.6 |
| Avg latency | 1909.7 ms | 2022.2 ms |
| p50 | 660 ms | 530 ms |
| p95 | 7200 ms | 7700 ms |
| p99 | 9500 ms | 12000 ms |
| Max | 12622.8 ms | 24649.5 ms |

Endpoint detail:

| Endpoint | Count | p50 | p95 | p99 | Failures |
|----------|-------|-----|-----|-----|----------|
| `/api/auth/session` | 3,836 | 160 ms | 1000 ms | 11000 ms | 0 |
| `/api/rbac/admin-tab-gates` | 2,845 | 300 ms | 1700 ms | 10000 ms | 0 |
| `/api/admin/platform-config` | 873 | 1400 ms | 4800 ms | 11000 ms | 0 |
| `/api/chat/conversations [get]` | 947 | 1200 ms | 3400 ms | 12000 ms | 947 expected |
| `/api/chat/conversations [list]` | 4,581 | 3100 ms | 6400 ms | 14000 ms | 0 |
| `/api/admin/stats` | 1,795 | 710 ms | 9800 ms | 15000 ms | 0 |
| `/api/dynamic-agents/available` | 1,785 | 2100 ms | 9700 ms | 11000 ms | 0 |

### Browser route timing under 1000-user load

This route sweep ran while a separate 1,000-user Locust run was active.

| Route | Status | Elapsed |
|-------|--------|---------|
| `/` | 200 | 20516 ms |
| `/chat` | 200 | 18187 ms |
| `/skills` | 200 | 1895 ms |
| `/task-builder` | 200 | 2766 ms |
| `/workflows` | 200 | 1643 ms |
| `/knowledge-bases` | 200 | 1110 ms |

Summary:

| Metric | Value |
|--------|-------|
| Route failures | 0 |
| Route p50 | 1895 ms |
| Route p95 | 18187 ms |
| Route max | 20516 ms |
| Chat input fill | 17 ms |
| Report | `reports/ui-elements-branch-s3-under-1000u-load-20260620-052158.json` |

Paired Locust run:

| Metric | Value |
|--------|-------|
| Report | `reports/1000u-branch-s3-ui-under-load-20260620-002118.html` |
| Requests | 18,125 |
| Expected fake-get failures | 1,032 |
| Other failures | 0 |
| RPS | 241.0 |
| Avg latency | 2473.4 ms |
| p50 | 730 ms |
| p95 | 8500 ms |
| p99 | 26000 ms |

---

## Follow-up: 1000-User Tail Latency

This branch improved the clean 300-user UI/API path and moved audit writes out
of the UI request path. It did not prove a 1,000-user tail-latency win in the
full `docker-compose.dev.yaml` stack.

### Current conclusion

| Area | Status |
|------|--------|
| Audit-service write path | Healthy at 1,000 users. S3 writes drained fully. |
| 300-user UI/API path | Strong improvement. p95 dropped from 2405.6 ms to 354.7 ms. |
| 1,000-user compose p50 | Slightly better. 660 ms to 530 ms. |
| 1,000-user compose p95/p99 | Still poor. p95 7200 ms to 7700 ms, p99 9500 ms to 12000 ms. |

### Evidence

| Signal | Finding |
|--------|---------|
| `audit-service` CPU | Average 5.5%, max 27.34%. Not the bottleneck. |
| `caipe-ui-prod` CPU | Average 113.0%, max 139.86%. UI container was hot. |
| Audit queue | Queue size 0 after run. |
| Audit flushes | 17,228 accepted, 17,228 flushed, 0 failed flushes. |
| Worst p95 endpoint | `/api/admin/stats` at 9800 ms. |
| Next worst p95 endpoint | `/api/dynamic-agents/available` at 9700 ms. |
| Chat list p95 | `/api/chat/conversations [list]` at 6400 ms. |

### Non-goals

- Do not add more audit-service write-path changes unless new evidence shows
  audit-service is on the hot path.
- Do not claim 1,000-user success based on the current compose run.
- Do not tune blindly. Add measurements first, then optimize the endpoint or
  service that owns the tail.

### Recommended next work

1. **Make the benchmark production-like**

   Run the 1,000-user workload against a deployment shape closer to production:

   - 2 or 3 `caipe-ui` replicas behind a load balancer.
   - Dedicated resource limits for UI, MongoDB, OpenFGA, PostgreSQL, and
     audit-service.
   - Same audit-service S3 backend used in the branch compose test.
   - Per-container CPU, memory, restart count, and network I/O captured for the
     whole run.
   - Per-endpoint Locust CSVs retained in `reports/`.

2. **Add request-path observability**

   Capture enough timing data to explain the p95 and p99 instead of only seeing
   the final response time:

   - Node.js event-loop delay and heap usage for `caipe-ui`.
   - MongoDB query duration, collection name, and index usage for hot routes.
   - OpenFGA request count, batch size, latency, and error rate.
   - Cache hit, miss, and shared in-flight counts per cached route.
   - Route fanout per browser navigation.

3. **Reduce initial page-load fanout**

   Home, Admin, and Chat currently create bursty API traffic during navigation.
   At 1,000 users that fanout becomes tail latency.

   Candidate changes:

   - Defer non-critical widgets until after first paint.
   - Lazy-load health, badges, and secondary admin panels.
   - Avoid polling during initial route hydration.
   - Coalesce duplicate same-user requests during one navigation.
   - Treat status panels as stale-while-revalidate where freshness allows it.

4. **Target the worst endpoints**

   Start with the endpoints that dominate the 1,000-user p95:

   | Endpoint | Current 1,000-user p95 | Next investigation |
   |----------|------------------------|--------------------|
   | `/api/admin/stats` | 9800 ms | Precompute or cache aggregates. Avoid live multi-collection scans on page load. |
   | `/api/dynamic-agents/available` | 9700 ms | Cache longer, refresh on config change, and avoid repeated discovery work. |
   | `/api/chat/conversations [list]` | 6400 ms | Verify indexes, trim projections, paginate sidebar data, and defer enrichment. |
   | `/api/admin/platform-config` | 4800 ms | Cache config reads and separate authorized mutation checks from read hydration. |
   | `/api/rbac/admin-tab-gates` | 1700 ms | Batch secondary Slack/Webex checks and verify OpenFGA cache/replica settings. |

5. **Scale the UI runtime**

   One Next.js container is the likely choke point in the compose run. Validate:

   - Multiple `caipe-ui` replicas.
   - Horizontal scaling behavior under sticky and non-sticky sessions.
   - Whether per-process caches should remain local or move to Redis.
   - Node heap settings and event-loop delay under 1,000 users.

6. **Tune MongoDB and OpenFGA with measurements**

   Only tune after query/RPC measurements are captured.

   - Confirm MongoDB indexes for chat list and admin stats queries.
   - Set MongoDB pool sizes from observed concurrency.
   - Enable or evaluate OpenFGA check/query cache.
   - Test OpenFGA with more replicas or larger connection pools.
   - Batch remaining secondary checks that still run as sequential loops.

7. **Improve broad audit reads separately**

   The audit write path is healthy. Audit read path is acceptable for the new
   5-minute default, but broad windows still scan and sort too much data.

   Follow-up options:

   - Cursor pagination for audit-service reads.
   - A compact audit index for broad historical queries.
   - Approximate counts for wide windows so the UI does not need full-window
     sorting before returning the first page.

### Acceptance criteria for the follow-up

The next performance PR should be considered successful only when:

- A 1,000-user run has zero unexpected failures.
- The run uses a production-like multi-replica UI shape or clearly documents why
  a single UI container is still representative.
- `audit-service` remains healthy with queue size 0 and failed flushes 0.
- Per-endpoint p95 and p99 improve for the worst routes listed above.
- Browser route timing under load improves for `/`, `/chat`, and Admin.
- The benchmark report includes enough timing data to attribute the remaining
  tail to UI, MongoDB, OpenFGA, network, or browser route fanout.

---

## Audit Read Window Benchmark

This run was added after the 1,000-user S3 benchmark made the RBAC Audit tab
slow to open. The old default read path queried a 24-hour S3 window, scanned
the day partition, loaded all matching Parquet objects, sorted all matches,
and returned only the first page.

Changes:

- RBAC Audit tab defaults to `Last 5 min`.
- Time range options: `5m`, `15m`, `30m`, `1h`, `6h`, `12h`, `24h`, `7d`, and custom from/to.
- `/api/admin/audit-events` forwards `window` and `time_resolution`.
- `audit-service` accepts `window` and `time_resolution`.
- S3 writes use minute-resolution object prefixes.
- S3 reads use minute/hour/day-aware prefix listing and object timestamp pruning.
- `docker-compose.dev.yaml` now passes AWS SDK env vars into `audit-service` for S3 mode.

Validation:

| Check | Result |
|-------|--------|
| Python audit-service tests | `4 passed` |
| UI RBAC audit tests | `15 passed` |
| UI build | Passed |
| Audit-service readiness | `backend=s3`, `failed_flushes=0` |

### Read Timing

Before the read-window change:

| Path | Window | Time |
|------|--------|------|
| Direct `audit-service` read | 24h default | 9.1 s |
| UI `/api/admin/audit-events` wrapper | 24h default | 17.5 s |

After the read-window change:

| Path | Window | Time | Records | Total |
|------|--------|------|---------|-------|
| Direct `audit-service` | 5m | 0.98 s | 30 | 41 |
| Direct `audit-service` | 15m | 2.98 s | 30 | 221 |
| Direct `audit-service` | 30m | 11.35 s | 30 | 17,657 |
| Direct `audit-service` | 1h | 11.00 s | 30 | 17,657 |
| UI API default | 5m | 0.98 s | 23 | 23 |
| UI API explicit | 15m | 2.66 s | 2 | 2 |

Browser smoke:

| Metric | Value |
|--------|-------|
| Page | `/admin?cat=security&tab=action-audit` |
| Status | 200 |
| Render time | 1.88 s |
| Default selected range | `5m` |
| Spinner count after load | 0 |
| Report | `reports/audit-ui-window-smoke-final-20260620-054845.json` |

Interpretation:

- The default RBAC Audit view no longer performs a full 24-hour S3 read.
- Wider windows that include the 1,000-user benchmark burst still take longer because they include roughly 17k records.
- The next readback improvement would be cursor pagination or a compact index so broad historical windows do not need exact full-window counts.
