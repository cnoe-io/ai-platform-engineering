import { getErrorMessage } from "@/lib/error-utils";
import {
ApiError,
getAuthFromBearerOrSession,
withErrorHandler,
} from '@/lib/api-middleware';
import { getServerOnlyConfig } from '@/lib/config';
import { requireAdminSurfaceManage } from '@/lib/rbac/require-openfga';
import { NextRequest,NextResponse } from 'next/server';

const PROM_QUERY_TIMEOUT_MS = 15_000;

/**
 * GET /api/admin/metrics
 *
 * Proxies PromQL queries to the Prometheus HTTP API.
 * Metrics are restricted to administrators.
 *
 * Query params:
 *   query  – PromQL expression (required)
 *   type   – "instant" | "range" (default: "instant")
 *   start  – RFC3339 or unix timestamp (range queries)
 *   end    – RFC3339 or unix timestamp (range queries)
 *   step   – duration string e.g. "60s" (range queries)
 *   time   – RFC3339 or unix timestamp (historical instant queries)
 *
 * POST /api/admin/metrics/batch (future)
 */
export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, 'metrics');

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

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  if (!query) {
    throw new ApiError('Missing required "query" parameter', 400);
  }

  const queryType = searchParams.get('type') || 'instant';
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const time = searchParams.get('time');
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
    if (time) params.set('time', time);
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
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('Prometheus query timed out', 504);
    }
    console.error('[Metrics] Prometheus fetch error:', getErrorMessage(err, ""));
    throw new ApiError('Failed to reach Prometheus', 502);
  } finally {
    clearTimeout(timeout);
  }
});

/**
 * POST /api/admin/metrics
 *
 * Batch endpoint — accepts an array of PromQL queries and returns results
 * in a single round-trip. Useful for dashboard initial load.
 */
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, 'metrics');

  const { prometheusUrl } = getServerOnlyConfig();

  if (!prometheusUrl) {
    return NextResponse.json(
      { success: false, error: 'Prometheus not configured', code: 'PROMETHEUS_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  const body = await request.json();
  const queries: Array<{
    id: string;
    query: string;
    type?: 'instant' | 'range';
    start?: string;
    end?: string;
    time?: string;
    step?: string;
    rangeSeconds?: number;
  }> = body.queries;

  if (!Array.isArray(queries) || queries.length === 0) {
    throw new ApiError('Request body must contain a "queries" array', 400);
  }

  if (queries.length > 20) {
    throw new ApiError('Maximum 20 queries per batch', 400);
  }

  const results: Record<string, unknown> = {};

  await Promise.all(
    queries.map(async (q) => {
      try {
        let promUrl: string;
        if (q.type === 'range') {
          const defaultEnd = Math.floor(Date.now() / 1000);
          const resolvedEnd = q.end || `${defaultEnd}`;
          const numericEnd = Number(resolvedEnd);
          const relativeRange = typeof q.rangeSeconds === 'number'
            && Number.isFinite(q.rangeSeconds)
            && q.rangeSeconds > 0
            ? Math.floor(q.rangeSeconds)
            : 3600;
          const resolvedStart = q.start || `${(Number.isFinite(numericEnd) ? numericEnd : defaultEnd) - relativeRange}`;
          const params = new URLSearchParams({
            query: q.query,
            start: resolvedStart,
            end: resolvedEnd,
            step: q.step || '60s',
          });
          promUrl = `${prometheusUrl}/api/v1/query_range?${params}`;
        } else {
          const params = new URLSearchParams({ query: q.query });
          if (q.time) params.set('time', q.time);
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
      } catch (err) {
        results[q.id] = {
          status: 'error',
          error: err instanceof Error && err.name === 'AbortError'
            ? 'Prometheus query timed out'
            : getErrorMessage(err, ""),
        };
      }
    }),
  );

  return NextResponse.json({ success: true, data: results }, {
    headers: { 'Cache-Control': 'no-store' },
  });
});
