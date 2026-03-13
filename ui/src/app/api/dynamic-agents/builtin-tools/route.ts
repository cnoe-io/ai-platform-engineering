/**
 * API route for listing available built-in tools.
 *
 * Proxies to the Dynamic Agents backend /api/v1/builtin-tools endpoint.
 * Returns tool definitions for dynamic UI rendering.
 *
 * This endpoint does not require authentication - it returns static metadata.
 */

import { NextRequest } from "next/server";
import { getServerConfig } from "@/lib/config";
import {
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";

/**
 * GET /api/dynamic-agents/builtin-tools
 * List available built-in tools and their configuration options.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const config = getServerConfig();

  if (!config.dynamicAgentsEnabled) {
    throw new ApiError("Dynamic agents are not enabled", 403);
  }

  const dynamicAgentsUrl = config.dynamicAgentsUrl;
  if (!dynamicAgentsUrl) {
    throw new ApiError("Dynamic agents URL not configured", 500);
  }

  try {
    const response = await fetch(`${dynamicAgentsUrl}/api/v1/builtin-tools`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError(
        `Backend error: ${response.status} - ${errorText}`,
        response.status
      );
    }

    const data = await response.json();

    // Backend returns { success: true, data: { tools: [...] } }
    // We pass through the tools array
    return successResponse(data.data?.tools || []);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      `Failed to fetch builtin tools: ${error instanceof Error ? error.message : "Unknown error"}`,
      500
    );
  }
});
