import { NextRequest } from "next/server";
import {
  ApiError,
  requireRbacPermission,
  withAuth,
} from "@/lib/api-middleware";
import type { OpenFgaTupleKey } from "@/lib/rbac/openfga";

export const ALLOWED_RELATIONS = new Set([
  "member",
  "can_call",
  "can_use",
  "can_manage",
  "can_read",
  "can_ingest",
  "can_admin",
]);

const SAFE_ID = /^[A-Za-z0-9._:@#*+-]+$/;

export function validateTupleKey(tuple: unknown): OpenFgaTupleKey {
  if (!tuple || typeof tuple !== "object") {
    throw new ApiError("tuple must be an object", 400);
  }
  const candidate = tuple as Partial<OpenFgaTupleKey>;
  const user = candidate.user?.trim();
  const relation = candidate.relation?.trim();
  const object = candidate.object?.trim();
  if (!user || !relation || !object) {
    throw new ApiError("tuple requires user, relation, and object", 400);
  }
  if (![user, relation, object].every((value) => SAFE_ID.test(value))) {
    throw new ApiError("tuple contains unsupported characters", 400);
  }
  if (!ALLOWED_RELATIONS.has(relation)) {
    throw new ApiError(`unsupported relation: ${relation}`, 400);
  }

  const isUserMembership = user.startsWith("user:") && relation === "member" && object.startsWith("team:");
  const isTeamAgent =
    user.startsWith("team:") &&
    user.endsWith("#member") &&
    ["can_use", "can_manage"].includes(relation) &&
    object.startsWith("agent:");
  const isTeamTool =
    user.startsWith("team:") &&
    user.endsWith("#member") &&
    relation === "can_call" &&
    object.startsWith("tool:");
  const isTeamKb =
    user.startsWith("team:") &&
    user.endsWith("#member") &&
    ["can_read", "can_ingest", "can_admin"].includes(relation) &&
    object.startsWith("knowledge_base:");
  const isCoarseMcp = user.startsWith("user:") && relation === "can_call" && object === "document:mcp";

  if (!isUserMembership && !isTeamAgent && !isTeamTool && !isTeamKb && !isCoarseMcp) {
    throw new ApiError("tuple does not match the CAIPE OpenFGA model", 400);
  }
  return { user, relation, object };
}

export async function withOpenFgaViewAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>
): Promise<T> {
  return withAuth(request, async (_req, _user, session) => {
    await requireRbacPermission(session, "admin_ui", "view");
    return handler();
  });
}

export async function withOpenFgaAdminAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>
): Promise<T> {
  return withAuth(request, async (_req, _user, session) => {
    await requireRbacPermission(session, "admin_ui", "admin");
    return handler();
  });
}
