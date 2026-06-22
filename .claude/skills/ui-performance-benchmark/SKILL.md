---
name: ui-performance-benchmark
description: Run and document CAIPE UI/BFF performance benchmarks with Locust against the Docker Compose UI, including audit-service, OpenFGA, MongoDB, Keycloak, RAG, and dynamic-agents health context. Use when asked to run UI performance, BFF latency, Locust load tests, benchmark user-count sweeps, or update UI benchmark result docs.
---

# UI Performance Benchmark

## Overview

Benchmark the CAIPE UI/BFF with Locust against the Docker Compose stack, then summarize and optionally record results in the evaluation docs.

Primary files:

- `scripts/locustfile.py`
- `ui/mint-test-session.mjs`
- `docs/docs/evaluations/ui-performance-benchmark-results.md`
- `docs/docs/security/rbac/audit-log-performance.md`

## Preflight

1. Inspect the current harness and prior docs before running:

```bash
sed -n '1,220p' scripts/locustfile.py
sed -n '1,220p' docs/docs/evaluations/ui-performance-benchmark-results.md
sed -n '1,220p' docs/docs/security/rbac/audit-log-performance.md
```

2. Start or verify the prod-parity UI stack:

```bash
docker compose -f docker-compose.dev.yaml --profile caipe-ui-prod up -d
curl -sS http://localhost:3000/api/health
docker ps --filter name=caipe-ui --format '{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'
```

3. Use the running UI container's `NEXTAUTH_SECRET` so the benchmark session cookie matches the server:

```bash
export NEXTAUTH_SECRET="$(
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' caipe-ui-prod \
    | sed -n 's/^NEXTAUTH_SECRET=//p' \
    | head -1
)"
```

`scripts/locustfile.py` mints a test session through `ui/mint-test-session.mjs` at Locust startup. To debug session minting directly:

```bash
cd ui
NEXTAUTH_SECRET="$NEXTAUTH_SECRET" node mint-test-session.mjs
```

## Run

Default comparable run:

```bash
mkdir -p reports
ts="$(date -u +%Y%m%dT%H%M%SZ)"
locust -f scripts/locustfile.py \
  --host http://localhost:3000 \
  --users 300 \
  --spawn-rate 20 \
  --run-time 10m \
  --headless \
  --html "reports/300u-ui-benchmark-${ts}.html" \
  --csv "reports/300u-ui-benchmark-${ts}"
```

For a quick smoke run, reduce runtime:

```bash
locust -f scripts/locustfile.py \
  --host http://localhost:3000 \
  --users 300 \
  --spawn-rate 50 \
  --run-time 30s \
  --headless \
  --html "reports/300u-ui-smoke-${ts}.html" \
  --csv "reports/300u-ui-smoke-${ts}" \
  --only-summary
```

For a sweep, run the same harness at:

```text
5, 10, 50, 100, 300, 500, 1000
```

Keep spawn rate and duration explicit in the report so comparisons are fair.

## What to Measure

Capture:

- Requests per second
- p50, p95, p99 latency
- Error rate and expected synthetic errors
- Slowest endpoints
- Container health for audit-service, OpenFGA, MongoDB, Keycloak, RAG, and dynamic-agents
- Relevant container logs during or immediately after the run

The benchmark stresses UI/BFF paths such as platform health, admin dashboard/state reads, RBAC/admin gate checks, dynamic agent availability, audit reads/search/export paths, and chat/conversation state paths. Treat `scripts/locustfile.py` as the exact source of truth for the current endpoint mix.

Historical takeaway from the docs: 300-user behavior improved meaningfully after audit offload and BFF caching/coalescing. At 1000 users, throughput and p50 improved somewhat, but p95/p99 tail latency remained poor in full Docker Compose.

## Report

After a run:

1. Summarize aggregate RPS, total requests, failure count, p50, p95, p99, and max latency.
2. List the slowest endpoints by p95/p99.
3. Explain expected synthetic failures separately from real failures. For example, the fake conversation lookup may return 400 or 404 depending on the current route validation.
4. Mention whether the UI and backing services stayed healthy.
5. If asked to persist results, update:
   - `docs/docs/evaluations/ui-performance-benchmark-results.md`
   - `docs/docs/security/rbac/audit-log-performance.md` when audit/RBAC behavior is part of the run

Reports under `reports/` are ignored by git and are suitable for local artifacts.
