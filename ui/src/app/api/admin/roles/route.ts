import { NextRequest } from "next/server";
import {
  withErrorHandler,
  successResponse,
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
} from "@/lib/api-middleware";
import { listRealmRoles, createRealmRole } from "@/lib/rbac/keycloak-admin";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

    const roles = await listRealmRoles();
    console.log(
      `[Admin Roles] Listed ${roles.length} realm role(s) by ${user.email}`
    );

    return successResponse({
      roles,
      total: roles.length,
    });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");

    const body = (await request.json()) as {
      name?: unknown;
      description?: unknown;
    };

    if (typeof body.name !== "string" || body.name.trim() === "") {
      throw new ApiError("Role name is required", 400);
    }

    const name = body.name.trim();
    const description =
      typeof body.description === "string" ? body.description : undefined;

    await createRealmRole(name, description);

    console.log(`[Admin Roles] Created realm role "${name}" by ${user.email}`);

    return successResponse(
      {
        message: "Role created successfully",
        name,
      },
      201
    );
});
