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
} from "@/lib/api-middleware";
import { caipeOrgKey } from "@/lib/rbac/organization";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

interface Team {
  _id: unknown;
  name: string;
  slug?: string;
  description?: string;
  members?: Array<{ user_id?: string; email?: string; role?: string }>;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function userTeamRole(team: Team, userEmail: string): string | null {
  const email = normalizeEmail(userEmail);
  const member = team.members?.find((entry) => normalizeEmail(entry.user_id ?? entry.email) === email);
  return member?.role ?? null;
}

async function canManageOrganization(session: Parameters<typeof requireResourcePermission>[0]): Promise<boolean> {
  try {
    await requireResourcePermission(session, { type: "organization", id: caipeOrgKey(), action: "manage" });
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /api/dynamic-agents/teams
 * List teams the current user is a member of.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);

    const teamsCollection = await getCollection<Team>("teams");

    // Organization admins can see all teams; team-scoped users see memberships only.
    const isAdmin = await canManageOrganization(session);
    const query = isAdmin ? {} : { "members.user_id": user.email };

    const teams = (await teamsCollection
      .find(query)
      .project({ _id: 1, name: 1, slug: 1, description: 1, members: 1 })
      .sort({ name: 1 })
      .toArray()) as Team[];

    return successResponse(
      teams.map((team) => ({
        _id: String(team._id),
        name: team.name,
        slug: team.slug,
        description: team.description,
        user_role: isAdmin ? "admin" : userTeamRole(team, user.email),
        can_own_agents: isAdmin || ["admin", "owner"].includes(userTeamRole(team, user.email) ?? ""),
      })),
    );
});
