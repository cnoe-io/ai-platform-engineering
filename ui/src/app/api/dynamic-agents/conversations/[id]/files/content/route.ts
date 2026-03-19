/**
 * Proxy route for fetching dynamic agent file content.
 *
 * GET /api/dynamic-agents/conversations/[id]/files/content?agent_id=X&path=Y
 *
 * This proxies to the Dynamic Agents service which retrieves file content
 * from the LangGraph checkpointer state.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  ApiError,
} from "@/lib/api-middleware";
import { getServerConfig } from "@/lib/config";

/**
 * GET /api/dynamic-agents/conversations/[id]/files/content
 * Proxy to Dynamic Agents service to get file content from checkpointer.
 */
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { id: conversationId } = await context.params;

    if (!conversationId) {
      throw new ApiError("Conversation ID is required", 400);
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agent_id");
    const path = searchParams.get("path");

    if (!agentId) {
      throw new ApiError("agent_id query parameter is required", 400);
    }

    if (!path) {
      throw new ApiError("path query parameter is required", 400);
    }

    return await withAuth(request, async (req, user, session) => {
      const config = getServerConfig();
      
      if (!config.dynamicAgentsEnabled) {
        throw new ApiError("Dynamic agents are not enabled", 403);
      }
      
      if (!config.dynamicAgentsUrl) {
        throw new ApiError("Dynamic agents URL not configured", 500);
      }
      
      // Build the backend URL
      const backendUrl = new URL(
        `/api/v1/conversations/${conversationId}/files/content`,
        config.dynamicAgentsUrl
      );
      backendUrl.searchParams.set("agent_id", agentId);
      backendUrl.searchParams.set("path", path);

      // Build headers for the backend request
      const backendHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Forward the access token to the Dynamic Agents backend
      if (session.accessToken) {
        backendHeaders["Authorization"] = `Bearer ${session.accessToken}`;
      }

      // Forward the request to the Dynamic Agents service
      const response = await fetch(backendUrl.toString(), {
        method: "GET",
        headers: backendHeaders,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Failed to fetch file content: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.detail || errorMessage;
        } catch {
          // Use default error message
        }
        throw new ApiError(errorMessage, response.status);
      }

      const data = await response.json();
      return NextResponse.json(data);
    });
  }
);
