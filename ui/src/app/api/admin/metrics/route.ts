import { NextRequest, NextResponse } from 'next/server';
import { getServerOnlyConfig } from '@/lib/config';
import {
  withAuth,
  withErrorHandler,
  ApiError,
} from '@/lib/api-middleware';

const PROM_QUERY_TIMEOUT_MS = 15_000;

/**
 * GET /api/admin/metrics
 *
 * Proxies PromQL queries to the Prometheus HTTP API.
 * Admin-only — requires OIDC admin group membership.
 *
 * Query params:
 *   query  – PromQL expression (required)
 *   type   – "instant" | "range" (default: "instant")
 *   start  – RFC3339 or unix timestamp (range queries)
 *   end    – RFC3339 or unix timestamp (range queries)
 *   step   – duration string e.g. "60s" (range queries)
 *
 * POST /api/admin/metrics/batch (future)
 */
export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const { prometheusUrl } = getServerOnlyConfig();

  if (!prometheusUrl) {
    return NextResponse.json(
      {
        success: false,
        error: 'Prometheus not configured — set PROMETHEUS_URL env var',
        code: 'PROMETHEUS_NOT_CONFIGURED',
      },
      { status: 503 },
    );
  }

  return withAuth(request, async (_req, _user, session) => {
    if (session.role !== 'admin') {
      throw new ApiError('Admin access required', 403);
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    if (!query) {
      throw new ApiError('Missing required "query" parameter', 400);
    }

    const queryType = searchParams.get('type') || 'instant';
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const step = searchParams.get('step') || '60s';

    let promUrl: string;

    if (queryType === 'range') {
      if (!start || !end) {
        throw new ApiError('Range queries require "start" and "end" parameters', 400);
      }
      const params = new URLSearchParams({ query, start, end, step });
      promUrl = `${prometheusUrl}/api/v1/query_range?${params}`;
    } else {
      const params = new URLSearchParams({ query });
      promUrl = `${prometheusUrl}/api/v1/query?${params}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROM_QUERY_TIMEOUT_MS);

    try {
      const promResponse = await fetch(promUrl, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!promResponse.ok) {
        const body = await promResponse.text().catch(() => '');
        console.error(`[Metrics] Prometheus returned ${promResponse.status}: ${body.slice(0, 500)}`);
        throw new ApiError(`Prometheus query failed (${promResponse.status})`, 502);
      }

      const data = await promResponse.json();

      return NextResponse.json({ success: true, data }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      if (err.name === 'AbortError') {
        throw new ApiError('Prometheus query timed out', 504);
      }
      console.error('[Metrics] Prometheus fetch error:', err.message);
      throw new ApiError('Failed to reach Prometheus', 502);
    } finally {
      clearTimeout(timeout);
    }
  });
});

/**
 * POST /api/admin/metrics
 *
 * Batch endpoint — accepts an array of PromQL queries and returns results
 * in a single round-trip. Useful for dashboard initial load.
 */
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const { prometheusUrl } = getServerOnlyConfig();

  if (!prometheusUrl) {
    return NextResponse.json(
      { success: false, error: 'Prometheus not configured', code: 'PROMETHEUS_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  return withAuth(request, async (_req, _user, session) => {
    if (session.role !== 'admin') {
      throw new ApiError('Admin access required', 403);
    }

    const body = await request.json();
    const queries: Array<{
      id: string;
      query: string;
      type?: 'instant' | 'range';
      start?: string;
      end?: string;
      step?: string;
    }> = body.queries;

    if (!Array.isArray(queries) || queries.length === 0) {
      throw new ApiError('Request body must contain a "queries" array', 400);
    }

    if (queries.length > 20) {
      throw new ApiError('Maximum 20 queries per batch', 400);
    }

    const results: Record<string, any> = {};

    await Promise.all(
      queries.map(async (q) => {
        try {
          let promUrl: string;
          if (q.type === 'range') {
            const params = new URLSearchParams({
              query: q.query,
              start: q.start || `${Math.floor(Date.now() / 1000) - 3600}`,
              end: q.end || `${Math.floor(Date.now() / 1000)}`,
              step: q.step || '60s',
            });
            promUrl = `${prometheusUrl}/api/v1/query_range?${params}`;
          } else {
            const params = new URLSearchParams({ query: q.query });
            promUrl = `${prometheusUrl}/api/v1/query?${params}`;
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), PROM_QUERY_TIMEOUT_MS);

          try {
            const res = await fetch(promUrl, {
              signal: controller.signal,
              headers: { Accept: 'application/json' },
            });
            if (res.ok) {
              results[q.id] = await res.json();
            } else {
              results[q.id] = { status: 'error', error: `HTTP ${res.status}` };
            }
          } finally {
            clearTimeout(timeout);
          }
        } catch (err: any) {
          results[q.id] = { status: 'error', error: err.message };
        }
      }),
    );

    return NextResponse.json({ success: true, data: results }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
});
