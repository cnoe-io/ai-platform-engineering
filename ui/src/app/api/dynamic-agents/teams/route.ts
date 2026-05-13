/**
 * API route for listing teams the current user belongs to.
 * Used by the agent editor to populate the team sharing dropdown.
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withErrorHandler,
  successResponse,
  getAuthFromBearerOrSession,
  requireRbacPermission,
} from "@/lib/api-middleware";

interface Team {
  _id: string;
  name: string;
  description?: string;
}

/**
 * GET /api/dynamic-agents/teams
 * List teams the current user is a member of.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "dynamic_agent", "view");

    const teamsCollection = await getCollection<Team>("teams");

    // Admins can see all teams (to share agents with any team);
    // non-admins only see teams they belong to.
    const isAdmin = user.role === "admin";
    const query = isAdmin ? {} : { "members.user_id": user.email };

    const teams = await teamsCollection
      .find(query)
      .project({ _id: 1, name: 1, description: 1 })
      .sort({ name: 1 })
      .toArray();

    return successResponse(teams);
});
