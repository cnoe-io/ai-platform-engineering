/**
 * Proxy route for fetching dynamic agent conversation file list.
 *
 * GET /api/dynamic-agents/conversations/[id]/files/list?agent_id=X
 *
 * This proxies to the Dynamic Agents service which retrieves file paths
 * from the LangGraph checkpointer state.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
  proxyRequest,
} from "@/lib/da-proxy";

/**
 * GET /api/dynamic-agents/conversations/[id]/files/list
 * Proxy to Dynamic Agents service to get file list from checkpointer.
 */
export async function GET(
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

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");

  if (!agentId) {
    return NextResponse.json(
      { success: false, error: "agent_id query parameter is required" },
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
    `/api/v1/conversations/${conversationId}/files/list`,
    daConfig.dynamicAgentsUrl,
  );
  backendUrl.searchParams.set("agent_id", agentId);

  return proxyRequest(backendUrl.toString(), "GET", authResult, "[files/list]");
}
