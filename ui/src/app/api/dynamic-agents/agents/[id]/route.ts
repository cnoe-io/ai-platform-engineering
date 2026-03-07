/**
 * API route for fetching a single dynamic agent by ID.
 *
 * GET /api/dynamic-agents/agents/[id]
 * Returns the agent configuration if the user has access to it.
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  getUserTeamIds,
} from "@/lib/api-middleware";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

const COLLECTION_NAME = "dynamic_agents";

/**
 * GET /api/dynamic-agents/agents/[id]
 * Fetch a single dynamic agent by ID.
 * Returns 404 if not found or user doesn't have access.
 */
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await context.params;

    if (!id) {
      throw new ApiError("Agent ID is required", 400);
    }

    return await withAuth(request, async (req, user, session) => {
      const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

      // Find the agent
      const agent = await collection.findOne({ _id: id });

      if (!agent) {
        throw new ApiError("Agent not found", 404);
      }

      // Check access permissions (unless admin)
      if (session.role !== "admin") {
        const userTeams = await getUserTeamIds(user.email);

        const hasAccess =
          // Owner always has access
          agent.owner_id === user.email ||
          // Global agents are accessible to everyone
          agent.visibility === "global" ||
          // Team agents are accessible to team members
          (agent.visibility === "team" &&
            agent.shared_with_teams?.some((team) => userTeams.includes(team)));

        if (!hasAccess) {
          throw new ApiError("Agent not found", 404); // Return 404 to not leak existence
        }

        // Non-admins can only see enabled agents
        if (!agent.enabled) {
          throw new ApiError("Agent not found", 404);
        }
      }

      return successResponse(agent);
    });
  }
);
