/**
 * Proxy route for fetching persisted stream events from the Supervisor A2A service.
 *
 * GET /api/dynamic-agents/conversations/[id]/events
 *
 * Proxies to Supervisor A2A: GET /api/v1/conversations/{id}/events
 *
 * Returns the raw stream events recorded for a conversation (or a specific
 * turn when ?turn_id=<id> is supplied).  These events are used by the UI
 * to reconstruct the timeline and agent activity panels after a page reload,
 * replacing the need for the UI to write events to MongoDB itself.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  ApiError,
} from "@/lib/api-middleware";
import { getInternalA2AUrl } from "@/lib/config";

/**
 * GET /api/dynamic-agents/conversations/[id]/events
 * Proxy to Supervisor A2A to retrieve persisted stream events.
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

      // Forward all query params (e.g. turn_id, page, page_size) upstream
      const { searchParams } = new URL(request.url);
      const backendUrl = new URL(
        `/api/v1/conversations/${conversationId}/events`,
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
        let errorMessage = `Failed to fetch events: ${response.status}`;
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
