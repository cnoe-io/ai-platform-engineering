/**
 * Server-side toggle gate for Agentic SDLC API routes.
 *
 * When the feature is disabled at the server layer
 * (Config.shipLoopEnabled === false) the wrapped route MUST return HTTP
 * 404 with an empty body. We deliberately use 404 (not 403/401) to avoid
 * leaking the feature's existence on hosts that have it disabled, and
 * to match the gating contract in
 * docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/contracts/http-api.md.
 *
 * The retired per-user `shipLoop` feature flag is no longer consulted.
 * UI-side, install/enabled and RBAC gating come from the Agentic Apps
 * registry; this server gate exists to keep API + page routes 404 when
 * the operator turns the feature off via env. The webhook receiver
 * relies on the same env gate since GitHub has no per-user identity.
 *
 * This module deliberately does NOT import from `next/server` so it can
 * be unit-tested in jsdom without polyfilling the full Web Fetch globals.
 * Route handlers can return plain `Response` objects; Next.js accepts
 * them just fine.
 */

import { getServerConfig } from "@/lib/config";

/**
 * Anything Next will pass to a route handler — we don't care about the
 * concrete shape because the gate decides purely on env state.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgenticSdlcRouteHandler = (req: any, ctx?: any) => Promise<Response> | Response;

const NOT_FOUND_RESPONSE = (): Response =>
  new Response(null, { status: 404 });

/**
 * Wrap a Agentic SDLC route handler with the server-side toggle check.
 *
 * If `SHIP_LOOP_ENABLED !== "true"`, the wrapped handler is never invoked
 * and the caller receives 404. Otherwise the handler runs as written.
 */
export function withAgenticSdlcGate(
  handler: AgenticSdlcRouteHandler,
): AgenticSdlcRouteHandler {
  return async (req, ctx) => {
    if (!getServerConfig().shipLoopEnabled) {
      return NOT_FOUND_RESPONSE();
    }
    return handler(req, ctx);
  };
}

/**
 * Convenience for server components / layouts that need to bail out
 * before rendering the Agentic SDLC tree. Caller should follow up with
 * Next's `notFound()` helper when this returns false.
 */
export function isAgenticSdlcServerEnabled(): boolean {
  return getServerConfig().shipLoopEnabled;
}
