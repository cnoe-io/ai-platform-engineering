/**
 * API route for probing MCP servers to discover available tools.
 * 
 * This endpoint proxies to the dynamic-agents backend service which
 * actually connects to the MCP server and retrieves the tool list.
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireAdmin,
} from "@/lib/api-middleware";
import type { MCPServerConfig, MCPToolInfo } from "@/types/dynamic-agent";

const COLLECTION_NAME = "mcp_servers";

// Dynamic agents backend URL
const DYNAMIC_AGENTS_URL = process.env.DYNAMIC_AGENTS_URL || "http://localhost:8100";

/**
 * POST /api/mcp-servers/probe?id=<server_id>
 * Probe an MCP server to discover available tools.
 * Requires admin role.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Server ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);

    // Check if server exists
    const server = await collection.findOne({ _id: id });
    if (!server) {
      throw new ApiError("MCP server not found", 404);
    }

    if (!server.enabled) {
      throw new ApiError("MCP server is disabled", 400);
    }

    try {
      // Build headers with auth token
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Forward the access token to the Dynamic Agents backend
      if (session.accessToken) {
        headers["Authorization"] = `Bearer ${session.accessToken}`;
      }

      // Call the dynamic agents backend to probe the server
      const response = await fetch(`${DYNAMIC_AGENTS_URL}/api/v1/mcp-servers/${id}/probe`, {
        method: "POST",
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          errorData.detail || `Probe failed with status ${response.status}`,
          response.status
        );
      }

      const probeResult = await response.json();
      
      // Forward the probe result from backend, preserving success/error status
      if (probeResult.success === false) {
        // Backend returned a probe failure (e.g., connection error)
        return successResponse({
          server_id: id,
          success: false,
          error: probeResult.error || "Probe failed",
          tools: [],
        });
      }

      return successResponse({
        server_id: id,
        success: true,
        tools: probeResult.tools || [],
      });
    } catch (err: any) {
      // If it's already an ApiError, rethrow
      if (err instanceof ApiError) {
        throw err;
      }

      // Handle connection errors to the backend
      if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("fetch failed")) {
        throw new ApiError(
          "Dynamic agents service is not available. Please ensure it is running.",
          503
        );
      }

      throw new ApiError(err.message || "Failed to probe MCP server", 500);
    }
  });
});
