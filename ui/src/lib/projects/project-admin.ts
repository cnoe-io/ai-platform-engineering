// assisted-by Cursor Composer

import { caipeOrgKey } from "@/lib/rbac/organization";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

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
