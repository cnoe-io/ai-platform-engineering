/**
 * Proxy route for clearing conversation checkpoint data (admin only).
 *
 * POST /api/dynamic-agents/conversations/[id]/clear
 *
 * This proxies to the Dynamic Agents service admin endpoint that clears
 * checkpoint data while keeping conversation metadata for audit purposes.
 */

import {
authenticateRequest,
getDynamicAgentsConfig,
proxyRequest,
} from "@/lib/da-proxy";
import { authorizeConversationWriteAccess, resolveConversationRuntimeId } from "@/app/api/v1/chat/_conversation-authz";
import { requireNativeHarnessOperation } from "@/lib/harness-conversation-operation";
import { NextRequest,NextResponse } from "next/server";

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
  const authResult = await authenticateRequest(request, {
    resource: "dynamic_agent",
    scope: "invoke",
  });
  if (authResult instanceof NextResponse) return authResult;

  const access = await authorizeConversationWriteAccess(authResult, conversationId);
  if (access.denial) return access.denial;
  const agentId = access.conversation.participants?.find((participant) => participant.type === "agent")?.id;
  if (!agentId) return NextResponse.json({ success: false, error: "Conversation has no agent binding" }, { status: 409 });
  const runtimeId = await resolveConversationRuntimeId(access.conversation);
  const unsupported = await requireNativeHarnessOperation(agentId, runtimeId, "native checkpoint clear");
  if (unsupported) return unsupported;

  // Check DA config
  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  // Build backend URL
  const backendUrl = new URL(
    `/api/v1/conversations/${encodeURIComponent(runtimeId)}/clear`,
    daConfig.dynamicAgentsUrl,
  );

  return proxyRequest(backendUrl.toString(), "POST", authResult, "[clear]");
}
