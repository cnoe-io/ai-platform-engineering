/**
 * Proxy route for clearing conversation checkpoint data (admin only).
 *
 * POST /api/dynamic-agents/conversations/[id]/clear
 *
 * This proxies to the Dynamic Agents service admin endpoint that clears
 * checkpoint data while keeping conversation metadata for audit purposes.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
  proxyRequest,
} from "@/lib/da-proxy";

/**
 * POST /api/dynamic-agents/conversations/[id]/clear
 * Proxy to Dynamic Agents service to clear checkpoint data (admin only).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: conversationId } = await context.params;

  if (!conversationId) {
    return NextResponse.json(
      { success: false, error: "Conversation ID is required" },
      { status: 400 },
    );
  }

  // Authenticate
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  // Check DA config
  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  // Build backend URL
  const backendUrl = new URL(
    `/api/v1/conversations/${conversationId}/clear`,
    daConfig.dynamicAgentsUrl,
  );

  return proxyRequest(backendUrl.toString(), "POST", authResult, "[clear]");
}
