import { NextRequest } from "next/server";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
  ApiError,
} from "@/lib/api-middleware";
import {
  listIdpAliases,
  listIdpMappers,
  createGroupRoleMapper,
} from "@/lib/rbac/keycloak-admin";

export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, user, session) => {
    requireAdmin(session);
    console.log("[Admin RoleMappings] GET list", { email: user.email });
    const aliases = (await listIdpAliases()).filter((idp) => idp.alias);
    const nested = await Promise.all(
      aliases.map(async (idp) => {
        const mappers = await listIdpMappers(idp.alias);
        return mappers.map((mapper) => ({ ...mapper, idpAlias: idp.alias }));
      })
    );
    const mappers = nested.flat();
    console.log("[Admin RoleMappings] GET list done", {
      idpCount: aliases.length,
      mapperCount: mappers.length,
    });
    return successResponse({ mappers, idpAliases: aliases });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, user, session) => {
    requireAdmin(session);
    const body = (await request.json()) as Record<string, unknown>;
    const { idpAlias, groupName, roleName } = body;
    if (typeof idpAlias !== "string" || !idpAlias.trim()) {
      throw new ApiError("idpAlias must be a non-empty string", 400);
    }
    if (typeof groupName !== "string" || !groupName.trim()) {
      throw new ApiError("groupName must be a non-empty string", 400);
    }
    if (typeof roleName !== "string" || !roleName.trim()) {
      throw new ApiError("roleName must be a non-empty string", 400);
    }
    const a = idpAlias.trim();
    const g = groupName.trim();
    const r = roleName.trim();
    const created = await createGroupRoleMapper(a, g, r);
    console.log("[Admin RoleMappings] POST create", {
      email: user.email,
      idpAlias: a,
      groupName: g,
      roleName: r,
    });
    return successResponse(created, 201);
  });
});
