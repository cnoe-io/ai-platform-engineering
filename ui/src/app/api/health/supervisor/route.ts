/**
 * GET /api/health/supervisor
 *
 * Server-side probe of the CAIPE supervisor (A2A) agent card.
 *
 * WHY a proxy:
 *   - The browser cannot reach the supervisor directly in cluster deployments
 *     (supervisor lives on an internal Service). Client-side fetch would CORS
 *     and/or DNS-fail for every user even when the supervisor is healthy.
 *   - `/api/admin/system-health` already does the right thing for admins, but
 *     the user-facing "System Status" popover runs for every authenticated
 *     user, so we expose a minimal, authenticated-only endpoint here.
 *
 * Response:
 *   { status: "healthy" | "unhealthy", latency_ms, url, agentCard? }
 *
 * The full agent card is included when the probe succeeds so useCAIPEHealth
 * can still enumerate agents/tags without a second round trip.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, withAuth } from '@/lib/api-middleware';
import { getInternalA2AUrl, config } from '@/lib/config';

type Body =
  | {
      status: 'healthy';
      latency_ms: number;
      url: string;
      agentCard?: unknown;
    }
  | {
      status: 'unhealthy';
      latency_ms: number;
      url: string;
      detail?: string;
    };

export const GET = withErrorHandler<Body>(async (request: NextRequest) => {
  return withAuth(request, async () => {
    const internalUrl = getInternalA2AUrl();
    // Public URL is displayed in the popover; server still uses internalUrl for the probe.
    const displayUrl = config.caipeUrl || internalUrl;
    const agentCardUrl = `${internalUrl}/.well-known/agent-card.json`;

    const start = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(agentCardUrl, { method: 'GET', signal: ctrl.signal, headers: { Accept: 'application/json' } });
      clearTimeout(timer);
      const latency = Date.now() - start;

      // Any HTTP response (including 4xx) means the server is reachable.
      // We still try to parse the body when it's a 2xx so the hook can
      // display agents/tags without a second call.
      let agentCard: unknown;
      if (res.ok) {
        try {
          agentCard = await res.json();
        } catch {
          // Non-JSON body — server is up but returned something unexpected; no big deal.
        }
      }

      return NextResponse.json({
        status: 'healthy',
        latency_ms: latency,
        url: displayUrl,
        agentCard,
      } satisfies Body);
    } catch (err) {
      clearTimeout(timer);
      const latency = Date.now() - start;
      return NextResponse.json(
        {
          status: 'unhealthy',
          latency_ms: latency,
          url: displayUrl,
          detail: err instanceof Error ? err.message.slice(0, 120) : 'probe failed',
        } satisfies Body,
        // 200 so the client's status logic doesn't treat the *probe* as a failure;
        // the body tells the UI whether the supervisor is up.
        { status: 200 },
      );
    }
  });
});
