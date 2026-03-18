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
  withAuth,
  withErrorHandler,
  ApiError,
} from "@/lib/api-middleware";
import { getServerConfig } from "@/lib/config";

/**
 * POST /api/dynamic-agents/conversations/[id]/clear
 * Proxy to Dynamic Agents service to clear checkpoint data (admin only).
 */
export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { id: conversationId } = await context.params;

    if (!conversationId) {
      throw new ApiError("Conversation ID is required", 400);
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
        `/api/v1/conversations/${conversationId}/clear`,
        config.dynamicAgentsUrl
      );

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
        method: "POST",
        headers: backendHeaders,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Failed to clear conversation: ${response.status}`;
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
