import { type NextRequest } from "next/server";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
  ApiError,
} from "@/lib/api-middleware";
import {
  getRoleByName,
  assignRealmRolesToUser,
  removeRealmRolesFromUser,
} from "@/lib/rbac/keycloak-admin";

type RoleNameInput = { name?: string };

function parseRolesBody(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("Body must be a JSON object", 400);
  }
  const roles = (body as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) {
    throw new ApiError("roles must be an array", 400);
  }
  const names: string[] = [];
  for (const item of roles) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError("Each role entry must be an object", 400);
    }
    const n = (item as RoleNameInput).name;
    if (typeof n !== "string" || !n.trim()) {
      throw new ApiError("Each role must have a non-empty name string", 400);
    }
    names.push(n.trim());
  }
  if (names.length === 0) {
    throw new ApiError("roles array must not be empty", 400);
  }
  return names;
}

export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    return withAuth(request, async (req, _user, session) => {
      requireAdmin(session);
      const params = await context.params;
      const id = params.id;

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new ApiError("Invalid JSON body", 400);
      }

      const names = parseRolesBody(body);
      const resolved = await Promise.all(names.map((name) => getRoleByName(name)));
      await assignRealmRolesToUser(id, resolved);

      return successResponse({ ok: true });
    });
  }
);

export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    return withAuth(request, async (req, _user, session) => {
      requireAdmin(session);
      const params = await context.params;
      const id = params.id;

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new ApiError("Invalid JSON body", 400);
      }

      const names = parseRolesBody(body);
      const resolved = await Promise.all(names.map((name) => getRoleByName(name)));
      await removeRealmRolesFromUser(id, resolved);

      return successResponse({ ok: true });
    });
  }
);
