import { isBootstrapAdmin } from "@/lib/auth-config";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { adminSurfaceObject } from "@/lib/rbac/baseline-access";

export interface TomeAdminSession {
  sub?: string;
  user?: { email?: string | null };
}

/**
 * Returns true when the caller has can_manage on admin_surface:tome.
 * Org admins inherit this automatically via the FGA model. Fails-closed.
 */
export async function isTomeAdmin(session: TomeAdminSession): Promise<boolean> {
  const email = session.user?.email ?? "";
  if (isBootstrapAdmin(email)) return true;
  if (!session.sub) return false;
  try {
    const decision = await checkOpenFgaTuple({
      user: `user:${session.sub}`,
      relation: "can_manage",
      object: adminSurfaceObject("tome"),
    });
    return decision.allowed;
  } catch {
    return false;
  }
}
