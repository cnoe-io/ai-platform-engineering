/**
 * Conversation-scoped Dynamic Agents file list proxy.
 *
 * GET /api/dynamic-agents/conversations/[id]/files/list
 */

import { NextRequest, NextResponse } from "next/server";

import { withErrorHandler } from "@/lib/api-middleware";
import { authorizeConversationFileRequest } from "@/lib/conversation-file-authorization";
import { getDynamicAgentsConfig, proxyRequest } from "@/lib/da-proxy";

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> => {
    const { id: conversationId } = await context.params;
    if (!conversationId) {
      return NextResponse.json(
        { success: false, error: "Conversation ID is required" },
        { status: 400 },
      );
    }

    const authorization = await authorizeConversationFileRequest(
      request,
      conversationId,
      "read",
    );
    if (authorization instanceof NextResponse) return authorization;

    const daConfig = getDynamicAgentsConfig();
    if (daConfig instanceof NextResponse) return daConfig;

    const backendUrl = new URL("/api/v1/files/list", daConfig.dynamicAgentsUrl);
    backendUrl.searchParams.set(
      "fs_namespace",
      JSON.stringify([authorization.agentId, conversationId, "filesystem"]),
    );

    return proxyRequest(
      backendUrl.toString(),
      "GET",
      authorization.authResult,
      "[conversation-files/list]",
    );
  },
);
