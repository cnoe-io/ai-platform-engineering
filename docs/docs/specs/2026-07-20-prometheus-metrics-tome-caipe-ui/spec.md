# Feature Specification: Prometheus Metrics for tome-agent + caipe-ui

**Created**: 2026-07-20
**Status**: Implemented (local dev + Helm ServiceMonitor scope; tome-agent has no Helm chart yet — see Follow-ups)
**Input**: "Add a feature to monitor tome-agent and caipe-ui via prometheus metrics."

## Context

Before this change:

- No Prometheus/Grafana ran anywhere in Docker Compose. `PROMETHEUS_URL` was
  consumer-only (the UI's Admin > Metrics/Health PromQL proxy), never set
  locally.
- `dynamic-agents` was the only service with real `prometheus_client`
  instrumentation (`da_*` metrics, `PrometheusHTTPMiddleware`).
- `tome-agent` had a hand-rolled two-line `/metrics` (`ttt_agent_in_flight_runs`,
  `ttt_agent_uptime_seconds`) — not scraped anywhere.
- `caipe-ui` had **no metrics exporter at all**, despite the existing Grafana
  dashboard (`charts/ai-platform-engineering/data/grafana-dashboard-ai-platform.json`)
  already querying `http_requests_total{job=~"...caipe-ui..."}` — dead panels.
  It was also explicitly excluded from the umbrella Helm `ServiceMonitor`.

## Decisions (scoped via user Q&A)

1. **Scope**: local dev visibility *and* production Helm wiring (not local-only).
2. **tome-agent depth**: migrate to `prometheus_client` (matches the
   `dynamic-agents` convention) rather than staying hand-rolled.
3. **caipe-ui metrics**: HTTP metrics (request count/duration by route+status)
   *plus* Tome app-specific gauges (active chat sessions, ingest queue depth).

## Scope gap discovered mid-implementation

**There is no Helm subchart/Deployment/Service for `tome-agent`.** It only runs
via the standalone `docker-compose.tome.yaml` + an external "tome deploy"
mechanism, outside `charts/ai-platform-engineering/`. A `ServiceMonitor` needs
a real `Service` to select — fabricating one here would reference nothing.
Decision: ship the code-level instrumentation (portable to any deployment
target) and local docker-compose scrape wiring; skip a Helm ServiceMonitor for
tome-agent until it has an actual chart-owned Service (see Follow-ups).

## What changed

### tome-agent (`ai_platform_engineering/agents/tome/`)

- Added `prometheus-client==0.23.1` dependency.
- New `tome_agent/metrics.py`: `AgentMetrics` singleton (mirrors
  `dynamic_agents.metrics.agent_metrics`) + `PrometheusHTTPMiddleware` that
  serves `/metrics` and records HTTP duration/active-request gauges.
  Metrics: `tome_agent_request_duration_seconds`, `tome_agent_active_requests`,
  `tome_agent_in_flight_runs`, `tome_agent_runs_total{kind,status}`,
  `tome_agent_run_duration_seconds{kind,status}`, `tome_agent_uptime_seconds`.
  `kind` ∈ `chat|ingest|compact|synthesize` (the 4 SSE-streaming endpoints).
- `tome_agent/agent/main.py`: registered the middleware, removed the old
  hand-rolled `/metrics` route (now dead code — middleware intercepts the path
  before FastAPI routing), wired `run_started()`/`run_finished()` into each of
  the 4 streaming generators alongside the pre-existing `_state.in_flight_runs`
  bookkeeping.
- Metric names changed from `ttt_agent_*` to `tome_agent_*` — safe rename,
  nothing scraped the old names (no ServiceMonitor ever existed for this
  service).

### caipe-ui (`ui/`)

- Added `prom-client@15.1.3` dependency.
- New `ui/src/lib/metrics.ts`: registry singleton (survives Next.js dev
  hot-reload via `globalThis`), `recordHttpRequest()`, path-cardinality
  normalizer (ObjectId/UUID segments → `:id`, mirrors dynamic-agents'
  normalizer), `trackActiveStream()` (wraps a `ReadableStream` so a gauge
  reflects concurrency — increments once, decrements exactly once on close,
  error, or client disconnect).
  - `http_requests_total{method,route,status}` / `http_request_duration_seconds` —
    named to match the pre-existing (previously dead) Grafana dashboard query.
  - `tome_active_chat_sessions` — live gauge, incremented per proxied Tome
    chat SSE stream.
  - `tome_ingest_queue_depth` — async-collect gauge querying
    `tome_ingest_runs` (status `queued`) on each scrape, bounded by a 3s
    internal timeout so a Mongo outage can't make `/metrics` scrapes time out
    (worst case observed locally: ~5s with Mongo fully unreachable, vs. 30s+
    unbounded — still well under typical 10s scrape timeouts).
- `ui/src/lib/api-middleware.ts` (`withErrorHandler`): every API route already
  goes through this wrapper, so HTTP metrics are recorded there — no
  per-route instrumentation needed. Metrics recording is wrapped in its own
  try/catch; it must never affect request handling.
- New `ui/src/app/metrics/route.ts` — bare `/metrics` (not `/api/metrics`) to
  match the Prometheus Operator `ServiceMonitor` default path and every other
  instrumented service in this repo. Unauthenticated by design, like
  dynamic-agents' and tome-agent's `/metrics`.
- `ui/src/app/api/tome/projects/[slug]/chat/route.ts`: wraps the agent's SSE
  passthrough body in `trackActiveStream()` against `tome_active_chat_sessions`.

### Local dev (docker-compose)

- New opt-in `monitoring` profile in `docker-compose.dev.yaml` running
  `prom/prometheus:v3.13.1`, config at `deploy/prometheus/prometheus.yml`.
  Scrapes `caipe-ui-prod:3000`, `dynamic-agents:8001` (same compose network),
  and `tome-agent` via `host.docker.internal:9500` (published host port —
  tome-agent lives in the separate `docker-compose.tome.yaml` project, so this
  avoids depending on the manual `docker network connect` bridging used
  earlier in this session).
- `.env.example`: documented (commented-out) `PROMETHEUS_URL=http://prometheus:9090`
  next to the other observability vars, gated on enabling the `monitoring`
  profile.

### Helm (`charts/ai-platform-engineering/`)

- `templates/servicemonitor.yaml`: removed `caipe-ui` from the umbrella
  ServiceMonitor's exclusion list — it now has a working `/metrics` on its
  main `http` port, so the existing default `port: http, path: /metrics`
  selector picks it up like any other component.
- `data/grafana-dashboard-ai-platform.json`: added two stat panels — "Tome
  Active Chat Sessions" (`sum(tome_active_chat_sessions)` — additive across
  replicas) and "Tome Ingest Queue Depth" (`max(tome_ingest_queue_depth)` —
  every replica reports the same Mongo-derived count, so `max()` not `sum()`
  avoids over-counting).

## Follow-ups (not done here)

- **tome-agent has no Helm chart.** Once it gets a real Deployment/Service in
  this (or another) Helm chart, add a `servicemonitor-tome-agent.yaml`
  targeting its `/metrics` port, following the `servicemonitor-dynamic-agents.yaml`
  pattern.
- `metrics.serviceMonitor.enabled` still defaults to `false` — this change
  doesn't flip that default, only what gets scraped once an operator enables
  it.
