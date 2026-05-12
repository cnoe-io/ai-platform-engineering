/**
 * Extract per-task / per-skill grants from Keycloak JWT realm_access.roles (098).
 */

export function extractRealmRolesFromAccessToken(accessToken: string | undefined): string[] {
  if (!accessToken) return [];
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return [];
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf8");
    const payload = JSON.parse(json) as Record<string, unknown>;
    const ra = payload.realm_access as { roles?: string[] } | undefined;
    return Array.isArray(ra?.roles) ? [...ra.roles] : [];
  } catch {
    return [];
  }
}

export function extractRealmRolesFromSession(session: {
  accessToken?: string;
} | null): string[] {
  return extractRealmRolesFromAccessToken(session?.accessToken);
}

/**
 * Parse `task_user:<id>` and `task_admin:<id>` realm roles for Task Builder RBAC.
 */
export function extractTaskAccessFromJwtRoles(roles: string[]): {
  userTaskIds: string[];
  adminTaskIds: string[];
  allGrantedTaskIds: string[];
} {
  const userTaskIds: string[] = [];
  const adminTaskIds: string[] = [];
  for (const r of roles) {
    if (r.startsWith("task_user:")) {
      userTaskIds.push(r.slice("task_user:".length));
    } else if (r.startsWith("task_admin:")) {
      adminTaskIds.push(r.slice("task_admin:".length));
    }
  }
  const allGrantedTaskIds = [...new Set([...userTaskIds, ...adminTaskIds])];
  return { userTaskIds, adminTaskIds, allGrantedTaskIds };
}

/**
 * Parse `skill_user:<id>` and `skill_admin:<id>` realm roles for Skills Gateway RBAC.
 */
export function extractSkillAccessFromJwtRoles(roles: string[]): {
  userSkillIds: string[];
  adminSkillIds: string[];
  allGrantedSkillIds: string[];
} {
  const userSkillIds: string[] = [];
  const adminSkillIds: string[] = [];
  for (const r of roles) {
    if (r.startsWith("skill_user:")) {
      userSkillIds.push(r.slice("skill_user:".length));
    } else if (r.startsWith("skill_admin:")) {
      adminSkillIds.push(r.slice("skill_admin:".length));
    }
  }
  const allGrantedSkillIds = [...new Set([...userSkillIds, ...adminSkillIds])];
  return { userSkillIds, adminSkillIds, allGrantedSkillIds };
}
