/**
 * Proxy route for fetching dynamic agent HITL interrupt state.
 *
 * GET /api/dynamic-agents/conversations/[id]/interrupt-state?agent_id=X
 *
 * This is a lightweight endpoint that only checks for pending human-in-the-loop
 * interrupts. Messages are loaded separately from the MongoDB messages collection
 * via the standard /api/chat/conversations/[id]/messages endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  ApiError,
} from "@/lib/api-middleware";
import { getServerConfig } from "@/lib/config";

/**
 * GET /api/dynamic-agents/conversations/[id]/interrupt-state
 * Proxy to Dynamic Agents service to check for HITL interrupt state.
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

    if (!agentId) {
      throw new ApiError("agent_id query parameter is required", 400);
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
        `/api/v1/conversations/${conversationId}/interrupt-state`,
        config.dynamicAgentsUrl
      );
      backendUrl.searchParams.set("agent_id", agentId);

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
        let errorMessage = `Failed to fetch interrupt state: ${response.status}`;
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
