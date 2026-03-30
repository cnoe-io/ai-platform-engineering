/**
 * Proxy route for sandbox SSE event stream (denials + policy updates).
 *
 * GET /api/dynamic-agents/sandbox/events/[agentId]
 *
 * Streams events from the Dynamic Agents backend's sandbox denial queue.
 */

import { NextRequest } from "next/server";
import {
  withAuth,
  withErrorHandler,
  ApiError,
} from "@/lib/api-middleware";
import { getServerConfig } from "@/lib/config";

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ agentId: string }> }
  ) => {
    const { agentId } = await context.params;

    if (!agentId) {
      throw new ApiError("Agent ID is required", 400);
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
        `/api/v1/sandbox/events/${agentId}`,
        config.dynamicAgentsUrl
      );

      const backendHeaders: Record<string, string> = {
        Accept: "text/event-stream",
      };

      if (session.accessToken) {
        backendHeaders["Authorization"] = `Bearer ${session.accessToken}`;
      }

      const response = await fetch(backendUrl.toString(), {
        method: "GET",
        headers: backendHeaders,
      });

      if (!response.ok) {
        throw new ApiError(`Sandbox events failed: ${response.status}`, response.status);
      }

      return new Response(response.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    });
  }
);
