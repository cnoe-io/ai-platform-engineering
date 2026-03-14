/**
 * API route for listing teams the current user belongs to.
 * Used by the agent editor to populate the team sharing dropdown.
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
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
  return await withAuth(request, async (req, user) => {
    const teamsCollection = await getCollection<Team>("teams");

    // Find teams where the user is a member
    const teams = await teamsCollection
      .find({ "members.user_id": user.email })
      .project({ _id: 1, name: 1, description: 1 })
      .sort({ name: 1 })
      .toArray();

    return successResponse(teams);
  });
});
