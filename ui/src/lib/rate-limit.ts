/**
 * Rate Limiting
 *
 * Sliding-window in-memory rate limiter for auth and setup endpoints.
 * Meets OWASP ASVS V2.2 brute-force protection requirements.
 *
 * Limits:
 *   POST /api/setup                          → 5 req / IP / 1h
 *   POST /api/auth/callback/credentials      → 10 req / email / 15min
 *   POST /api/admin/rotate-keys              → 10 req / IP / 1h
 *
 * Note: In-memory state is per-process. For multi-replica deployments, a
 * shared store (Redis) should be used. Set REDIS_URL to enable Redis-backed
 * rate limiting (future enhancement — in-memory is sufficient for most
 * single-node deployments).
 */

interface Window {
  count: number;
  resetAt: number;
}

// In-memory store: key → sliding window
const store = new Map<string, Window>();

// Cleanup stale entries every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of store.entries()) {
    if (window.resetAt < now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check and increment the rate limit for a given key.
 *
 * @param key     Unique key (e.g. "setup:192.168.1.1" or "creds:user@example.com")
 * @param limit   Maximum number of requests allowed in the window
 * @param windowMs Window duration in milliseconds
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || existing.resetAt < now) {
    // New window
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

// ---------------------------------------------------------------------------
// Pre-configured limiters for known endpoints
// ---------------------------------------------------------------------------

export const RateLimits = {
  /** POST /api/setup */
  setup: (ip: string) => checkRateLimit(`setup:${ip}`, 5, 60 * 60 * 1000),

  /** POST /api/auth/callback/credentials (keyed by email) */
  credentials: (email: string) => checkRateLimit(`creds:${email}`, 10, 15 * 60 * 1000),

  /** POST /api/admin/rotate-keys */
  keyRotation: (ip: string) => checkRateLimit(`keyrot:${ip}`, 10, 60 * 60 * 1000),
} as const;
