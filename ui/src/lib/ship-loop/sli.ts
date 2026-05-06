/**
 * Ship Loop SLI counters and gauges.
 *
 * Pilot-scale, in-process, lock-free. We deliberately avoid bringing in
 * Prometheus client libraries here — the existing `useCAIPEHealth` /
 * `/api/health` surface in this app is the preferred export point, and
 * a Promql-shaped exporter can be wired later without changing the
 * recording API below.
 *
 * Per spec FR-029: four SLIs are required.
 *   - ship_loop_webhooks_total{outcome}     — counter
 *   - ship_loop_worker_queue_depth          — gauge
 *   - ship_loop_projection_latency_seconds  — histogram-ish summary
 *   - ship_loop_sse_active_connections      — gauge
 *
 * Server-only module.
 */

export type WebhookOutcome =
  | "accepted"
  | "rejected_signature"
  | "rejected_unknown_repo"
  | "rejected_malformed"
  | "queue_overflow_deferred";

interface CounterMap {
  [key: string]: number;
}

const webhookCounter: CounterMap = Object.create(null);
let workerQueueDepth = 0;
let sseActiveConnections = 0;

// Simple histogram: bucket boundaries in seconds
const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];
const latencyBuckets: number[] = LATENCY_BUCKETS.map(() => 0);
let latencyCount = 0;
let latencySum = 0;

export function recordWebhook(outcome: WebhookOutcome): void {
  webhookCounter[outcome] = (webhookCounter[outcome] ?? 0) + 1;
}

export function setWorkerQueueDepth(depth: number): void {
  if (Number.isFinite(depth) && depth >= 0) {
    workerQueueDepth = depth;
  }
}

export function incSseConnection(): void {
  sseActiveConnections++;
}

export function decSseConnection(): void {
  if (sseActiveConnections > 0) sseActiveConnections--;
}

export function recordProjectionLatency(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  latencyCount++;
  latencySum += seconds;
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    if (seconds <= LATENCY_BUCKETS[i]) {
      latencyBuckets[i]++;
    }
  }
}

export interface ShipLoopSliSnapshot {
  webhooks: Record<string, number>;
  worker_queue_depth: number;
  sse_active_connections: number;
  projection_latency: {
    count: number;
    sum_seconds: number;
    /** Bucket-le pairs in seconds → count of observations <= bucket. */
    buckets: { le: number; count: number }[];
  };
}

export function snapshotShipLoopSlis(): ShipLoopSliSnapshot {
  return {
    webhooks: { ...webhookCounter },
    worker_queue_depth: workerQueueDepth,
    sse_active_connections: sseActiveConnections,
    projection_latency: {
      count: latencyCount,
      sum_seconds: latencySum,
      buckets: LATENCY_BUCKETS.map((le, i) => ({ le, count: latencyBuckets[i] })),
    },
  };
}

/**
 * Test-only reset. NEVER call from production code paths.
 */
export function __resetShipLoopSlisForTests(): void {
  for (const k of Object.keys(webhookCounter)) delete webhookCounter[k];
  workerQueueDepth = 0;
  sseActiveConnections = 0;
  latencyCount = 0;
  latencySum = 0;
  for (let i = 0; i < latencyBuckets.length; i++) latencyBuckets[i] = 0;
}
