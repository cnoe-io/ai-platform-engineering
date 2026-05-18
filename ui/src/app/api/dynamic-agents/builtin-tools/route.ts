/**
 * API route for listing available built-in tools.
 *
 * Proxies to the Dynamic Agents backend `/api/v1/builtin-tools` endpoint.
 *
 * Although the backend route returns static metadata, the dynamic-agents
 * service runs with `DA_REQUIRE_BEARER=true` (the Spec 102 Phase 8 kill-
 * switch) so every request must carry the user's session JWT. We forward
 * it via the shared `da-proxy` helper, matching every other DA proxy
 * route in the Web UI backend.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
  proxyRequest,
} from "@/lib/da-proxy";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

export async function GET(request: NextRequest): Promise<Response> {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    await requireResourcePermission(
      { sub: authResult.subject, role: authResult.role, user: { email: authResult.email } },
      { type: "tool", id: "dynamic-agents-builtin", action: "discover" },
      { allowAdminBypass: true },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Access denied",
        code: (error as { code?: string }).code,
      },
      { status: (error as { statusCode?: number }).statusCode ?? 500 },
    );
  }

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
