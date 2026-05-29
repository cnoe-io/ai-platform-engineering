import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession, requireRbacPermission } from "@/lib/api-middleware";
import { isBootstrapAdmin } from "@/lib/auth-config";

export async function requireMigrationAdmin(request: NextRequest) {
  const { user, session } = await getAuthFromBearerOrSession(request);
  if (isBootstrapAdmin(user.email)) {
    return { user, session };
  }
  await requireRbacPermission(session, "admin_ui", "admin");
  return { user, session };
}

export async function requireMigrationSuperAdmin(request: NextRequest) {
  const auth = await requireMigrationAdmin(request);
  if (!isBootstrapAdmin(auth.user.email)) {
    const error = new Error("Bootstrap super-admin access required") as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = 403;
    error.code = "MIGRATION_SUPER_ADMIN_REQUIRED";
    throw error;
  }
  return auth;
}
