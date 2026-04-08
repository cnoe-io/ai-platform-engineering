/**
 * Proxy route for fetching a single persisted turn from the Supervisor A2A service.
 *
 * GET /api/dynamic-agents/conversations/[id]/turns/[turn_id]
 *
 * Proxies to Supervisor A2A: GET /api/v1/conversations/{id}/turns/{turn_id}
 *
 * Used by the stream-recovery polling loop in chat-store.ts: after a page
 * refresh mid-stream, the UI polls this endpoint every 2 s until
 * assistant_message.status transitions away from "streaming".
 */

import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  ApiError,
} from "@/lib/api-middleware";
import { getInternalA2AUrl } from "@/lib/config";

/**
 * GET /api/dynamic-agents/conversations/[id]/turns/[turn_id]
 * Proxy to Supervisor A2A to retrieve a single persisted turn.
 */
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string; turn_id: string }> }
  ) => {
    const { id: conversationId, turn_id: turnId } = await context.params;

    if (!conversationId) {
      throw new ApiError("Conversation ID is required", 400);
    }

    if (!turnId) {
      throw new ApiError("Turn ID is required", 400);
    }

    return await withAuth(request, async (_req, _user, session) => {
      const a2aBaseUrl = getInternalA2AUrl();

      const backendUrl = new URL(
        `/api/v1/conversations/${conversationId}/turns/${turnId}`,
        a2aBaseUrl
      );

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
        let errorMessage = `Failed to fetch turn: ${response.status}`;
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
