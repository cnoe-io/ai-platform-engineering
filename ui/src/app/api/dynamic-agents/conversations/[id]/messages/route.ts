/**
 * Proxy route for fetching conversation messages from the LangGraph checkpointer.
 *
 * GET /api/dynamic-agents/conversations/[id]/messages?agent_id=...
 */

import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  ApiError,
} from "@/lib/api-middleware";
import { getServerConfig } from "@/lib/config";

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { id: conversationId } = await context.params;

    if (!conversationId) {
      throw new ApiError("Conversation ID is required", 400);
    }

    const agentId = request.nextUrl.searchParams.get("agent_id");
    if (!agentId) {
      throw new ApiError("agent_id query parameter is required", 400);
    }

    return await withAuth(request, async (_req, _user, session) => {
      const config = getServerConfig();

      if (!config.dynamicAgentsEnabled) {
        throw new ApiError("Dynamic agents are not enabled", 403);
      }

      if (!config.dynamicAgentsUrl) {
        throw new ApiError("Dynamic agents URL not configured", 500);
      }

      const backendUrl = new URL(
        `/api/v1/conversations/${conversationId}/messages`,
        config.dynamicAgentsUrl
      );
      backendUrl.searchParams.set("agent_id", agentId);

      const backendHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (session.accessToken) {
        backendHeaders["Authorization"] = `Bearer ${session.accessToken}`;
      }

      const response = await fetch(backendUrl.toString(), {
        method: "GET",
        headers: backendHeaders,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Failed to fetch messages: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.detail || errorMessage;
        } catch {
          // Use default error message
        }
        throw new ApiError(errorMessage, response.status);
      }

      const data = await response.json();
      return NextResponse.json({ success: true, data });
    });
  }
);
