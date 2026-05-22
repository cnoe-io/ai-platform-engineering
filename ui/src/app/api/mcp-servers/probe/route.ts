/**
 * API route for probing MCP servers to discover available tools.
 *
 * This endpoint proxies to the dynamic-agents backend service which
 * actually connects to the MCP server and retrieves the tool list.
 * Auth is forwarded via X-User-Context header (same as chat routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withErrorHandler,
  successResponse,
  ApiError,
  getAuthFromBearerOrSession,
} from "@/lib/api-middleware";
import { authenticateRequest, buildBackendHeaders } from "@/lib/da-proxy";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import type { MCPServerConfig } from "@/types/dynamic-agent";

const COLLECTION_NAME = "mcp_servers";

// Dynamic agents backend URL
const DYNAMIC_AGENTS_URL = process.env.DYNAMIC_AGENTS_URL || "http://localhost:8100";

/**
 * POST /api/mcp-servers/probe?id=<server_id>
 * Probe an MCP server to discover available tools.
 *
 * Authorization model:
 *   Probing only enumerates the tools advertised by an MCP server — it is
 *   strictly less powerful than runtime tool *invocation*. Users who can
 *   read the server (because it's shared with them via team/channel/group
 *   membership, or because they are organization members or admins) need
 *   to be able to render the Probe button on the Create Agent → Tools
 *   step even if they don't yet have `can_invoke`. We therefore gate this
 *   route on `mcp_server:<id>#can_discover`. The authorization model
 *   defines `can_discover` as `can_read = reader ∪ can_use ∪ can_manage ∪
 *   owner`, which transitively grants discover to every direct relation
 *   (`reader`, `user`, `invoker`, `manager`, `owner`) and to indirect
 *   relations via `team#member`, `team#admin`, `external_group#member`,
 *   `slack_channel`, `webex_space`, `organization#member`, and
 *   `organization#admin`. Runtime tool invocation continues to enforce
 *   `can_invoke` separately on the agent execution path.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Server ID is required", 400);
  }

  const { session } = await getAuthFromBearerOrSession(request);

    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);

    // Check if server exists
    const server = await collection.findOne({ _id: id });
    if (!server) {
      throw new ApiError("MCP server not found", 404);
    }

    if (!server.enabled) {
      throw new ApiError("MCP server is disabled", 400);
    }
    await requireResourcePermission(session, { type: "mcp_server", id, action: "discover" });

    try {
      // Build headers with X-User-Context AND Authorization: Bearer
      // (Spec 102 Phase 11.4 — DA now requires Bearer; X-User-Context kept
      // for legacy claim hints but is no longer authoritative).
      const auth = await authenticateRequest(request);
      if (auth instanceof NextResponse) return auth;
      const headers = buildBackendHeaders("application/json", auth);

      // Call the dynamic agents backend to probe the server
      const response = await fetch(`${DYNAMIC_AGENTS_URL}/api/v1/mcp-servers/${id}/probe`, {
        method: "POST",
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          errorData.detail || `Probe failed with status ${response.status}`,
          response.status,
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
          503,
        );
      }

      throw new ApiError(err.message || "Failed to probe MCP server", 500);
    }
});
