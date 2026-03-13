/**
 * API routes for MCP Server management.
 *
 * - GET: Direct MongoDB access for reads
 * - POST, PUT, DELETE: Proxy to dynamic-agents backend for writes
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireAdmin,
  getPaginationParams,
  paginatedResponse,
} from "@/lib/api-middleware";
import type { MCPServerConfig } from "@/types/dynamic-agent";

const COLLECTION_NAME = "mcp_servers";
const DYNAMIC_AGENTS_URL =
  process.env.DYNAMIC_AGENTS_URL || "http://localhost:8100";

/**
 * GET /api/mcp-servers
 * List all MCP server configurations.
 * Requires admin role.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);
    const { page, pageSize, skip } = getPaginationParams(request);

    const [items, total] = await Promise.all([
      collection.find({}).sort({ name: 1 }).skip(skip).limit(pageSize).toArray(),
      collection.countDocuments({}),
    ]);

    return paginatedResponse(items, total, page, pageSize);
  });
});

/**
 * POST /api/mcp-servers
 * Create a new MCP server configuration.
 * Proxies to dynamic-agents backend.
 * Requires admin role.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body = await request.json();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (session.accessToken) {
      headers["Authorization"] = `Bearer ${session.accessToken}`;
    }

    const response = await fetch(`${DYNAMIC_AGENTS_URL}/api/v1/mcp-servers`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(
        data.detail || "Failed to create MCP server",
        response.status
      );
    }

    return successResponse(data.data, 201);
  });
});

/**
 * PUT /api/mcp-servers?id=<server_id>
 * Update an MCP server configuration.
 * Proxies to dynamic-agents backend.
 * Requires admin role.
 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Server ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body = await request.json();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (session.accessToken) {
      headers["Authorization"] = `Bearer ${session.accessToken}`;
    }

    const response = await fetch(
      `${DYNAMIC_AGENTS_URL}/api/v1/mcp-servers/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(
        data.detail || "Failed to update MCP server",
        response.status
      );
    }

    return successResponse(data.data);
  });
});

/**
 * DELETE /api/mcp-servers?id=<server_id>
 * Delete an MCP server configuration.
 * Proxies to dynamic-agents backend.
 * Requires admin role.
 */
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Server ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const headers: HeadersInit = {};
    if (session.accessToken) {
      headers["Authorization"] = `Bearer ${session.accessToken}`;
    }

    const response = await fetch(
      `${DYNAMIC_AGENTS_URL}/api/v1/mcp-servers/${id}`,
      {
        method: "DELETE",
        headers,
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(
        data.detail || "Failed to delete MCP server",
        response.status
      );
    }

    return successResponse({ deleted: id });
  });
});
