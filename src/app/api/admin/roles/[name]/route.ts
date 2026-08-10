import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import {
BUILT_IN_ROLES,
deleteRealmRole,
getRoleByName,
} from "@/lib/rbac/keycloak-admin";
import { NextRequest } from "next/server";

export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ name: string }> }
) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

    const params = await context.params;
    const roleName = decodeURIComponent(params.name);

    const role = await getRoleByName(roleName);
    if (!role) {
      throw new ApiError("Role not found", 404);
    }

    console.log(
      `[Admin Roles] Fetched realm role "${roleName}" by ${user.email}`
    );

    return successResponse({ role });
});

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ name: string }> }
) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");

    const params = await context.params;
    const roleName = decodeURIComponent(params.name);

    if ((BUILT_IN_ROLES as readonly string[]).includes(roleName)) {
      throw new ApiError("Cannot delete built-in role", 400);
    }

    await deleteRealmRole(roleName);

    console.log(
      `[Admin Roles] Deleted realm role "${roleName}" by ${user.email}`
    );

    return successResponse({ message: "Role deleted successfully" });
});
