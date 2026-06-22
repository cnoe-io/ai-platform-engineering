/**
 * API route for listing available built-in tools.
 *
 * Proxies to the Dynamic Agents backend `/api/v1/builtin-tools` endpoint.
 *
 * Authorization model:
 *   - The list is a static catalog of supported built-in tool *types*
 *     (web_search, file_io, ...), not a set of permissioned objects. It
 *     is the same shape as the AI Assist task registry: rendering the
 *     Create Agent wizard requires being able to read this catalog, but
 *     nothing here gives the caller call/use access to any concrete
 *     tool — per-tool authorization happens at MCP invocation time.
 *   - Earlier revisions gated this on
 *     `tool:dynamic-agents-builtin#can_discover`, but no production code
 *     path ever wrote that tuple, so every caller (admins included) was
 *     denied with a 403. The picker showed "Failed to load tools: Failed
 *     to fetch: 403" on the Create Agent → Tools step.
 *   - The route now mirrors how Create Agent itself is gated: it
 *     requires an authenticated session (so the request carries a real
 *     bearer token to dynamic-agents' `DA_REQUIRE_BEARER` middleware)
 *     and skips the OpenFGA check.
 */

import {
authenticateRequest,
getDynamicAgentsConfig,
proxyRequest,
} from "@/lib/da-proxy";
import { NextRequest,NextResponse } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  const backendUrl = new URL(
    "/api/v1/builtin-tools",
    daConfig.dynamicAgentsUrl,
  );

  return proxyRequest(
    backendUrl.toString(),
    "GET",
    authResult,
    "[builtin-tools]",
  );
}
