/**
 * Proxy route for fetching persisted turns from the Supervisor A2A service.
 *
 * GET /api/dynamic-agents/conversations/[id]/turns
 *
 * Proxies to Supervisor A2A: GET /api/v1/conversations/{id}/turns
 *
 * Returns the list of turns for a conversation.  Each turn corresponds to
 * one user-message / assistant-response exchange and carries high-level
 * metadata (turn_id, status, timestamps).  The companion /events route
 * returns the raw stream events that belong to each turn.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  ApiError,
} from "@/lib/api-middleware";
import { getInternalA2AUrl } from "@/lib/config";

/**
 * GET /api/dynamic-agents/conversations/[id]/turns
 * Proxy to Supervisor A2A to retrieve persisted turns.
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

    return await withAuth(request, async (_req, _user, session) => {
      const a2aBaseUrl = getInternalA2AUrl();

      // Forward any query params (e.g. page, page_size) to the upstream service
      const { searchParams } = new URL(request.url);
      const backendUrl = new URL(
        `/api/v1/conversations/${conversationId}/turns`,
        a2aBaseUrl
      );
      searchParams.forEach((value, key) => {
        backendUrl.searchParams.set(key, value);
      });

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
        let errorMessage = `Failed to fetch turns: ${response.status}`;
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
