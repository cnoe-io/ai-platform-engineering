/**
 * Prometheus metrics for caipe-ui.
 *
 * Two families:
 *  - HTTP metrics (`http_requests_total`, `http_request_duration_seconds`) —
 *    named to match the pre-existing (previously dead — nothing emitted
 *    these) panels in
 *    charts/ai-platform-engineering/data/grafana-dashboard-ai-platform.json,
 *    which already query `http_requests_total{job=~"...caipe-ui..."}` and
 *    group `by (job, status)`.
 *  - Tome app metrics (`tome_active_chat_sessions`, `tome_ingest_queue_depth`).
 *
 * Recorded from `withErrorHandler` (api-middleware.ts) rather than Next.js
 * Middleware, so every API route gets tracked automatically with no
 * per-route wiring and no Edge/Node runtime split to worry about.
 *
 * Module-singleton via `globalThis` so Next.js dev-mode hot reloads (a fresh
 * module instance per reload) don't throw on duplicate metric registration.
 */

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

type HttpLabels = "method" | "route" | "status";

interface CaipeMetrics {
  registry: Registry;
  httpRequestsTotal: Counter<HttpLabels>;
  httpRequestDurationSeconds: Histogram<HttpLabels>;
  /** In-flight Tome chat SSE streams proxied by this caipe-ui instance. */
  tomeActiveChatSessions: Gauge<string>;
}

declare global {
  var __caipeMetrics: CaipeMetrics | undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

async function queryIngestQueueDepth(): Promise<number> {
  const { getTomeIngestRunsCollection } = await import("./tome/mongo-collections");
  const runs = await getTomeIngestRunsCollection();
  return runs.countDocuments({ status: "queued" });
}

function buildMetrics(): CaipeMetrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpRequestsTotal = new Counter({
    name: "http_requests_total",
    help: "Total HTTP requests handled by the caipe-ui BFF API",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  });

  const httpRequestDurationSeconds = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status"],
    buckets: [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 30, 60, 120, 300],
    registers: [registry],
  });

  const tomeActiveChatSessions = new Gauge({
    name: "tome_active_chat_sessions",
    help: "Number of Tome chat SSE streams currently proxied by this caipe-ui instance",
    registers: [registry],
  });

  // Async collect: runs once per /metrics scrape, not per-request — cheap
  // enough for an indexed count query at typical scrape intervals (15-30s).
  // Bounded by a short timeout: Mongo's own server-selection timeout is ~30s,
  // which would make every scrape time out during a Mongo outage instead of
  // just reporting a stale gauge value.
  new Gauge({
    name: "tome_ingest_queue_depth",
    help: "Number of Tome ingest/synthesize runs currently queued (not yet started)",
    registers: [registry],
    async collect() {
      try {
        const depth = await withTimeout(queryIngestQueueDepth(), 3000);
        this.set(depth);
      } catch {
        // Tome disabled, Mongo not configured, or Mongo unreachable — leave
        // the gauge at 0/last known value rather than failing the scrape.
      }
    },
  });

  return { registry, httpRequestsTotal, httpRequestDurationSeconds, tomeActiveChatSessions };
}

export function getMetrics(): CaipeMetrics {
  if (!globalThis.__caipeMetrics) {
    globalThis.__caipeMetrics = buildMetrics();
  }
  return globalThis.__caipeMetrics;
}

/**
 * Bound label cardinality: collapse ObjectId/UUID/long-hex path segments to
 * `:id`. Mirrors dynamic_agents' `PrometheusHTTPMiddleware._normalise_path`.
 * Route params like `[slug]` are left as-is (bounded by project count, not
 * secret/PII).
 */
export function normalizeRoute(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => (seg.length >= 20 && /^[0-9a-f-]+$/i.test(seg) ? ":id" : seg))
    .join("/");
}

export function classifyStatus(code: number): "2xx" | "3xx" | "4xx" | "5xx" {
  if (code < 300) return "2xx";
  if (code < 400) return "3xx";
  if (code < 500) return "4xx";
  return "5xx";
}

/**
 * Record one completed HTTP request against the shared registry. Called from
 * `withErrorHandler` for every API route.
 */
export function recordHttpRequest(method: string, pathname: string, statusCode: number, durationSeconds: number): void {
  const { httpRequestsTotal, httpRequestDurationSeconds } = getMetrics();
  const route = normalizeRoute(pathname);
  const status = classifyStatus(statusCode);
  httpRequestsTotal.labels(method, route, status).inc();
  httpRequestDurationSeconds.labels(method, route, status).observe(durationSeconds);
}

/**
 * Wrap a ReadableStream so `gauge` reflects "currently streaming" concurrency:
 * incremented immediately, decremented exactly once on close, upstream error,
 * or client cancel (disconnect/tab close).
 */
export function trackActiveStream(
  body: ReadableStream<Uint8Array>,
  gauge: Gauge<string>,
): ReadableStream<Uint8Array> {
  gauge.inc();
  let decremented = false;
  const dec = () => {
    if (decremented) return;
    decremented = true;
    gauge.dec();
  };
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          dec();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        dec();
        controller.error(err);
      }
    },
    async cancel(reason) {
      dec();
      await reader.cancel(reason).catch(() => {});
    },
  });
}
