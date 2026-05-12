/**
 * API route for listing available middleware types.
 *
 * Proxies to the Dynamic Agents backend /api/v1/middleware endpoint.
 * Returns middleware definitions for dynamic UI rendering.
 *
 * Although the backend route returns static metadata, the dynamic-agents
 * service runs with `DA_REQUIRE_BEARER=true`, so every request must carry
 * the user's session JWT.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
  proxyRequest,
} from "@/lib/da-proxy";

/**
 * GET /api/dynamic-agents/middleware
 * List available middleware types and their configuration options.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  const backendUrl = new URL(
    "/api/v1/middleware",
    daConfig.dynamicAgentsUrl,
  );

  const response = await proxyRequest(
    backendUrl.toString(),
    "GET",
    authResult,
    "[middleware]",
  );

  if (!response.ok) return response;

  const payload = await response.json();
  return NextResponse.json({
    success: true,
    data: payload.data?.middleware || [],
  });
}
