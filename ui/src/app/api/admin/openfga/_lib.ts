import { NextRequest } from "next/server";
import {
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
} from "@/lib/api-middleware";
import type { OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { OPENFGA_ACTION_RELATIONS } from "@/lib/rbac/tuple-builders";
import { isUniversalRebacResourceType } from "@/lib/rbac/relationship-validator";

export const ALLOWED_RELATIONS = new Set(["member", "admin", ...OPENFGA_ACTION_RELATIONS]);

const SAFE_ID = /^[A-Za-z0-9._:@#*+-]+$/;
const SUBJECT_PREFIXES = ["user:", "service_account:", "anonymous:", "slack_channel:"];

function objectType(value: string): string | null {
  const separator = value.indexOf(":");
  return separator > 0 ? value.slice(0, separator) : null;
}

function isSupportedUniversalObject(value: string): boolean {
  const type = objectType(value);
  return Boolean(type && isUniversalRebacResourceType(type));
}

function isSupportedUniversalSubject(value: string): boolean {
  return (
    SUBJECT_PREFIXES.some((prefix) => value.startsWith(prefix)) ||
    /^team:[A-Za-z0-9._:@*+-]+#(member|admin)$/.test(value) ||
    /^external_group:[A-Za-z0-9._:@*+-]+#member$/.test(value)
  );
}

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
  const isUniversalRelationship =
    OPENFGA_ACTION_RELATIONS.includes(relation) &&
    isSupportedUniversalSubject(user) &&
    isSupportedUniversalObject(object);

  if (
    !isUserMembership &&
    !isTeamAgent &&
    !isTeamTool &&
    !isTeamKb &&
    !isCoarseMcp &&
    !isUniversalRelationship
  ) {
    throw new ApiError("tuple does not match the CAIPE OpenFGA model", 400);
  }
  return { user, relation, object };
}

export async function withOpenFgaViewAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>
): Promise<T> {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");
  return handler();
}

export async function withOpenFgaAdminAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>
): Promise<T> {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  return handler();
}
