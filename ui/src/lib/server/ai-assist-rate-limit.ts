/**
 * ai-assist-rate-limit — small in-process sliding-window rate limiter for
 * the `/api/ai/assist` route. Per-user, per-task: 30 calls / 5 min by
 * default; configurable via env.
 *
 * This is intentionally simple and process-local. In a multi-instance
 * deployment it limits *per pod*, not globally — that's fine as a first
 * line of defense; the upstream model provider has its own quotas. If we
 * ever need cluster-wide enforcement, swap the `Map` for a Redis store
 * behind the same `consume` interface.
 */

const DEFAULT_LIMIT = 30;
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
/** Cap on tracked entries so a flood of unique users doesn't grow forever. */
const MAX_ENTRIES = 5000;

interface BucketEntry {
  /** Sliding window of request timestamps (ms since epoch). */
  hits: number[];
  /** Last touch — used for LRU eviction. */
  lastTouchedAt: number;
}

const buckets = new Map<string, BucketEntry>();

function getLimit(): number {
  const raw = Number(process.env.AI_ASSIST_RATE_LIMIT_PER_WINDOW);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_LIMIT;
}

function getWindowMs(): number {
  const raw = Number(process.env.AI_ASSIST_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_WINDOW_MS;
}

function evictIfFull() {
  if (buckets.size < MAX_ENTRIES) return;
  // Drop the 256 oldest entries by `lastTouchedAt`.
  const sorted = [...buckets.entries()].sort(
    (a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt,
  );
  for (let i = 0; i < 256 && i < sorted.length; i++) {
    buckets.delete(sorted[i][0]);
  }
}

export interface RateLimitDecision {
  /** True when the request is allowed. */
  allowed: boolean;
  /** Calls remaining in the current window after this consume. */
  remaining: number;
  /** Hard ceiling for the window. */
  limit: number;
  /** Seconds until at least one slot frees up (for Retry-After). */
  retryAfterSec: number;
  /** Window duration in milliseconds (for client display). */
  windowMs: number;
}

/**
 * Try to consume one request slot for `(userId, taskId)`. Always returns
 * synchronously; never throws.
 *
 * `userId` should be the caller's stable identity (email/sub) — anonymous
 * sessions get bucketed under "anon" which intentionally throttles all
 * unauthenticated callers together as a safety net.
 */
export function consume(
  userId: string | undefined,
  taskId: string,
): RateLimitDecision {
  const limit = getLimit();
  const windowMs = getWindowMs();
  const now = Date.now();
  const key = `${userId || "anon"}::${taskId}`;

  const entry = buckets.get(key) ?? { hits: [], lastTouchedAt: now };
  // Drop hits outside the window.
  const windowStart = now - windowMs;
  entry.hits = entry.hits.filter((t) => t > windowStart);

  if (entry.hits.length >= limit) {
    const oldest = entry.hits[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldest + windowMs - now) / 1000),
    );
    entry.lastTouchedAt = now;
    buckets.set(key, entry);
    return {
      allowed: false,
      remaining: 0,
      limit,
      retryAfterSec,
      windowMs,
    };
  }

  entry.hits.push(now);
  entry.lastTouchedAt = now;
  buckets.set(key, entry);
  evictIfFull();

  return {
    allowed: true,
    remaining: Math.max(0, limit - entry.hits.length),
    limit,
    retryAfterSec: 0,
    windowMs,
  };
}

/** Test-only — clear all buckets between tests. */
export function __resetForTests(): void {
  buckets.clear();
}
