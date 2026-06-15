/**
 * Shared platform-admin check.
 *
 * A "platform admin" is either:
 *  - a bootstrap-admin break-glass email (env BOOTSTRAP_ADMIN_EMAILS), or
 *  - an authenticated user with the OpenFGA `can_manage` relation on the
 *    organization object (i.e. an org-admin).
 *
 * Extracted here so multiple route modules can import the same check without
 * duplicating the OpenFGA logic. The original copy lived in
 * unlinked-service-account.ts (as `isPlatformAdmin`); admin-tab-gates/route.ts
 * has its own local `hasOrganizationAdmin` which is equivalent.
 *
 * Note: admin-tab-gates/route.ts also has a `getSessionSubject` helper that
 * decodes an accessToken JWT to extract `sub` when session.sub is absent. That
 * richer variant is kept local to that route; the canonical check here covers
 * the majority of callers that receive session.sub directly from NextAuth.
 *
 * assisted-by Claude:claude-sonnet-4-6
 */

import { isBootstrapAdmin } from "@/lib/auth-config";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { organizationObjectId } from "@/lib/rbac/organization";

export interface PlatformAdminSession {
  sub?: string;
  user?: { email?: string | null };
}

/**
 * Returns true when the caller is a platform admin (org-admin or bootstrap-
 * admin break-glass). Fails-closed: returns false on any OpenFGA error.
 */
export async function hasOrganizationAdmin(session: PlatformAdminSession): Promise<boolean> {
  const email = session.user?.email ?? "";
  if (isBootstrapAdmin(email)) return true;
  if (!session.sub) return false;
  try {
    const decision = await checkOpenFgaTuple({
      user: `user:${session.sub}`,
      relation: "can_manage",
      object: organizationObjectId(),
    });
    return decision.allowed;
  } catch {
    return false;
  }
}

/**
 * Alias that matches the original name used in unlinked-service-account.ts —
 * kept for callers that imported `isPlatformAdmin` from that module.
 */
export const isPlatformAdmin = hasOrganizationAdmin;
