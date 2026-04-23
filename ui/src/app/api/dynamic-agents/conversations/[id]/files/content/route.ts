/**
 * Proxy route for dynamic agent file operations.
 *
 * GET /api/dynamic-agents/conversations/[id]/files/content?agent_id=X&path=Y
 * DELETE /api/dynamic-agents/conversations/[id]/files/content?agent_id=X&path=Y
 *
 * This proxies to the Dynamic Agents service which retrieves/deletes file content
 * from the LangGraph checkpointer state.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
  proxyRequest,
} from "@/lib/da-proxy";

/**
 * Validate common params and return backend URL, or a NextResponse error.
 */
async function resolveBackendUrl(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<{ backendUrl: string; authResult: Exclude<Awaited<ReturnType<typeof authenticateRequest>>, NextResponse> } | NextResponse> {
  const { id: conversationId } = await context.params;

  if (!conversationId) {
    return NextResponse.json(
      { success: false, error: "Conversation ID is required" },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");
  const path = searchParams.get("path");

  if (!agentId) {
    return NextResponse.json(
      { success: false, error: "agent_id query parameter is required" },
      { status: 400 },
    );
  }

  if (!path) {
    return NextResponse.json(
      { success: false, error: "path query parameter is required" },
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
    `/api/v1/conversations/${conversationId}/files/content`,
    daConfig.dynamicAgentsUrl,
  );
  backendUrl.searchParams.set("agent_id", agentId);
  backendUrl.searchParams.set("path", path);

  return { backendUrl: backendUrl.toString(), authResult };
}

/**
 * GET /api/dynamic-agents/conversations/[id]/files/content
 * Proxy to Dynamic Agents service to get file content from checkpointer.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const resolved = await resolveBackendUrl(request, context);
  if (resolved instanceof NextResponse) return resolved;

  return proxyRequest(resolved.backendUrl, "GET", resolved.authResult, "[files/content]");
}

/**
 * DELETE /api/dynamic-agents/conversations/[id]/files/content
 * Proxy to Dynamic Agents service to delete a file from checkpointer.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const resolved = await resolveBackendUrl(request, context);
  if (resolved instanceof NextResponse) return resolved;

  return proxyRequest(resolved.backendUrl, "DELETE", resolved.authResult, "[files/content]");
}
