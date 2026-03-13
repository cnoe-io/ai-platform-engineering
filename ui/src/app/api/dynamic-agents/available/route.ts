/**
 * API route for listing available dynamic agents for the current user.
 * 
 * This returns agents that the user can chat with:
 * - Global agents (visibility: 'global')
 * - Team agents (visibility: 'team') for teams the user belongs to
 * - Private agents (visibility: 'private') owned by the user
 * 
 * Only returns enabled agents.
 */

import { NextRequest } from "next/server";
import type { Filter } from "mongodb";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from "@/lib/api-middleware";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

const COLLECTION_NAME = "dynamic_agents";

/**
 * GET /api/dynamic-agents/available
 * List dynamic agents available for the current user to chat with.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    const userEmail = user.email || "";
    const userTeams = session.teams || [];

    // Build query for agents visible to this user:
    // 1. Global agents (anyone can see)
    // 2. Team agents where user is a member OR owned by user
    // 3. Private agents owned by this user
    // Use type assertion to satisfy MongoDB's strict Filter types
    const query: Filter<DynamicAgentConfig> = {
      enabled: true,
      $or: [
        { visibility: "global" as const },
        { visibility: "team" as const, shared_with_teams: { $in: userTeams } },
        { visibility: "team" as const, owner_id: userEmail },
        { visibility: "private" as const, owner_id: userEmail },
      ],
    };

    const agents = await collection
      .find(query)
      .sort({ name: 1 })
      .toArray();

    return successResponse(agents);
  });
});
