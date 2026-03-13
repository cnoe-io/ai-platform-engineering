/**
 * API routes for Dynamic Agents management.
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
  getUserTeamIds,
} from "@/lib/api-middleware";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

const COLLECTION_NAME = "dynamic_agents";
const DYNAMIC_AGENTS_URL =
  process.env.DYNAMIC_AGENTS_URL || "http://localhost:8100";

/**
 * GET /api/dynamic-agents
 * List dynamic agents visible to the current user.
 *
 * Query params:
 * - enabled_only=true: Only return enabled agents (useful for subagent selection)
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    const collection =
      await getCollection<DynamicAgentConfig>(COLLECTION_NAME);
    const { page, pageSize, skip } = getPaginationParams(request);
    const { searchParams } = new URL(request.url);
    const enabledOnly = searchParams.get("enabled_only") === "true";

    // Build visibility filter
    let query: any = {};

    if (session.role !== "admin") {
      // Non-admins see: their own, global, or team-shared agents
      const userTeams = await getUserTeamIds(user.email);

      query = {
        $and: [
          // enabled: true OR enabled field doesn't exist (defaults to true)
          { $or: [{ enabled: true }, { enabled: { $exists: false } }] },
          {
            $or: [
              { owner_id: user.email },
              { visibility: "global" },
              ...(userTeams.length > 0
                ? [{ visibility: "team", shared_with_teams: { $in: userTeams } }]
                : []),
            ],
          },
        ],
      };
    } else if (enabledOnly) {
      // Admin with enabled_only flag (e.g., for subagent selection)
      // enabled: true OR enabled field doesn't exist (defaults to true)
      query = { $or: [{ enabled: true }, { enabled: { $exists: false } }] };
    }

    const [items, total] = await Promise.all([
      collection
        .find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(pageSize)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return paginatedResponse(items, total, page, pageSize);
  });
});

/**
 * POST /api/dynamic-agents
 * Create a new dynamic agent configuration.
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

    const response = await fetch(`${DYNAMIC_AGENTS_URL}/api/v1/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(
        data.detail || "Failed to create agent",
        response.status
      );
    }

    return successResponse(data.data, 201);
  });
});

/**
 * PUT /api/dynamic-agents?id=<agent_id>
 * Update a dynamic agent configuration.
 * Proxies to dynamic-agents backend.
 * Requires admin role.
 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Agent ID is required", 400);
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

    const response = await fetch(`${DYNAMIC_AGENTS_URL}/api/v1/agents/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(
        data.detail || "Failed to update agent",
        response.status
      );
    }

    return successResponse(data.data);
  });
});

/**
 * DELETE /api/dynamic-agents?id=<agent_id>
 * Delete a dynamic agent configuration.
 * Proxies to dynamic-agents backend.
 * Requires admin role. System agents cannot be deleted.
 */
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Agent ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const headers: HeadersInit = {};
    if (session.accessToken) {
      headers["Authorization"] = `Bearer ${session.accessToken}`;
    }

    const response = await fetch(`${DYNAMIC_AGENTS_URL}/api/v1/agents/${id}`, {
      method: "DELETE",
      headers,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(
        data.detail || "Failed to delete agent",
        response.status
      );
    }

    return successResponse({ deleted: id });
  });
});
