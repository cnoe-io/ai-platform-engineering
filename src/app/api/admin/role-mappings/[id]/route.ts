import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { deleteIdpMapper } from "@/lib/rbac/keycloak-admin";
import { NextRequest } from "next/server";

export const DELETE = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { user, session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "admin_ui", "admin");

      const params = await context.params;
      const mapperId = params.id;
      const alias = request.nextUrl.searchParams.get("alias");
      if (!alias) {
        throw new ApiError("alias query parameter is required", 400);
      }
      await deleteIdpMapper(alias, mapperId);
      console.log("[Admin RoleMappings] DELETE", {
        email: user.email,
        alias,
        mapperId,
      });
      return successResponse({ ok: true });
  }
);
