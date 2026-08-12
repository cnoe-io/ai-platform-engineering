// assisted-by Cursor Composer

import { getUserTeamIds } from "@/lib/api-middleware";
import { caipeOrgKey } from "@/lib/rbac/organization";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import type { TeamMembershipSource } from "@/types/identity-group-sync";
import type { Team } from "@/types/teams";

/**
 * True if the user belongs to the project's team, using the same canonical
 * team-membership source that drives project visibility (GET /api/projects).
 * A team member may edit a project, so "can edit" matches "can see".
 */
export async function isProjectTeamMember(
  project: { team_id?: string | null },
  userEmail?: string | null,
): Promise<boolean> {
  const email = userEmail?.trim().toLowerCase();
  if (!email || !project.team_id) return false;
  const teamIds = await getUserTeamIds(email);
  return teamIds.includes(String(project.team_id));
}

export async function requireProjectsOrgAdmin(
  session: Parameters<typeof requireResourcePermission>[0],
): Promise<void> {
  await requireResourcePermission(session, {
    type: "organization",
    id: caipeOrgKey(),
    action: "manage",
  });
}

export async function canManageProjectsOrganization(
  session: Parameters<typeof requireResourcePermission>[0],
): Promise<boolean> {
  try {
    await requireProjectsOrgAdmin(session);
    return true;
  } catch {
    return false;
  }
}

/** True when an org admin or active canonical team member may assign a project. */
export async function canAssignProjectToTeam(
  team: Pick<Team, "slug">,
  actorEmail: string | null | undefined,
  isOrgAdmin: boolean,
): Promise<boolean> {
  if (isOrgAdmin) return true;
  const email = actorEmail?.trim().toLowerCase();
  const teamSlug = team.slug?.trim();
  if (!email || !teamSlug) return false;
  const sources = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");
  return Boolean(
    await sources.findOne({
      status: "active",
      user_email: email,
      team_slug: teamSlug,
    }),
  );
}
