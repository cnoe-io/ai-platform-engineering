/**
 * API route for listing available LLM models.
 *
 * Proxies to the Dynamic Agents backend /agents/models endpoint.
 * Returns a list of models that can be selected when creating/editing agents.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";

/**
 * GET /api/dynamic-agents/models
 * List available LLM models for agent configuration.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    const config = getServerConfig();

    if (!config.dynamicAgentsEnabled) {
      throw new ApiError("Dynamic agents are not enabled", 403);
    }

    const dynamicAgentsUrl = config.dynamicAgentsUrl;
    if (!dynamicAgentsUrl) {
      throw new ApiError("Dynamic agents URL not configured", 500);
    }

    // Build headers for the backend request
    const backendHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Forward the access token to the Dynamic Agents backend
    if (session.accessToken) {
      backendHeaders["Authorization"] = `Bearer ${session.accessToken}`;
    }

    // Forward user info headers for auth (fallback if backend uses these)
    if (user.email) {
      backendHeaders["X-User-Email"] = user.email;
    }
    if (session.role === "admin") {
      backendHeaders["X-User-Role"] = "admin";
    }
    if (session.teams?.length) {
      backendHeaders["X-User-Groups"] = session.teams.join(",");
    }

    try {
      const response = await fetch(`${dynamicAgentsUrl}/api/v1/agents/models`, {
        method: "GET",
        headers: backendHeaders,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ApiError(
          `Backend error: ${response.status} - ${errorText}`,
          response.status
        );
      }

      const data = await response.json();

      // Backend returns { success: true, data: [...] }
      // We pass through the data array
      return successResponse(data.data || []);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        `Failed to fetch models: ${error instanceof Error ? error.message : "Unknown error"}`,
        500
      );
    }
  });
});
