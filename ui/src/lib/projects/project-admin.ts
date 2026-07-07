// assisted-by Cursor Composer

import { getUserTeamIds } from "@/lib/api-middleware";
import { caipeOrgKey } from "@/lib/rbac/organization";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

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
