import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
} from "@/lib/api-middleware";
import type { OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { isUniversalRebacResourceType } from "@/lib/rbac/relationship-validator";
import { OPENFGA_ACTION_RELATIONS } from "@/lib/rbac/tuple-builders";
import { NextRequest } from "next/server";

export const ALLOWED_RELATIONS = new Set(["member", "admin", ...OPENFGA_ACTION_RELATIONS]);

// `/` is required for fine-grained MCP tool objects (`tool:<server>/<tool>`,
// `tool:<server>/*`) — without it validateTupleKey rejects every slash-tool
// tuple before the shape allowlist (which explicitly permits team#member→tool
// and universal caller→tool grants) can run. Mirrors EXACT_TUPLE_FIELD in
// tuples/route.ts, which already allows `/`. The per-shape allowlist below is
// the real authorization guard; SAFE_ID is only a coarse charset filter. (#33)
const SAFE_ID = /^[A-Za-z0-9._:@#*+/-]+$/;
const SUBJECT_PREFIXES = ["user:", "service_account:", "slack_channel:"];

export interface OpenFgaAuthContext {
  user: { email: string };
  session?: { accessToken?: string; sub?: string; org?: string } | null;
}

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
    /^organization:[A-Za-z0-9._:@*+-]+#(member|admin)$/.test(value) ||
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
  if (relation.startsWith("can_")) {
    throw new ApiError(
      `materialized relation ${relation} is not writable; use a base OpenFGA relation`,
      400
    );
  }

  // assisted-by Codex Codex-sonnet-4-6
  // The team model allows direct user grants for both base membership
  // relations. Live RBAC e2e uses this admin endpoint to seed team admins.
  const isUserMembership =
    user.startsWith("user:") &&
    ["member", "admin"].includes(relation) &&
    object.startsWith("team:");
  // assisted-by Codex Codex-sonnet-4-6
  // Baseline access and live RBAC setup seed organization membership through
  // the same admin tuple endpoint, so keep the validator aligned with the
  // OpenFGA organization model.
  const isUserOrganizationMembership =
    user.startsWith("user:") &&
    ["member", "admin"].includes(relation) &&
    object.startsWith("organization:");
  const isTeamAgent =
    user.startsWith("team:") &&
    ((user.endsWith("#member") && relation === "user") ||
      (user.endsWith("#admin") && relation === "manager")) &&
    object.startsWith("agent:");
  const isTeamTool =
    user.startsWith("team:") &&
    user.endsWith("#member") &&
    relation === "caller" &&
    object.startsWith("tool:");
  const isTeamKb =
    user.startsWith("team:") &&
    ((user.endsWith("#member") && ["reader", "ingestor"].includes(relation)) ||
      (user.endsWith("#admin") && relation === "manager")) &&
    object.startsWith("knowledge_base:");
  const isCoarseMcp = user.startsWith("user:") && relation === "caller" && object === "mcp_gateway:list";
  const isUserProfileOwner = user.startsWith("user:") && relation === "owner" && object.startsWith("user_profile:");
  const isBaselineAdminSurfaceReader =
    user.startsWith("user:") && relation === "reader" && object.startsWith("admin_surface:");
  const isUniversalRelationship =
    OPENFGA_ACTION_RELATIONS.includes(relation) &&
    isSupportedUniversalSubject(user) &&
    isSupportedUniversalObject(object);

  if (
    !isUserMembership &&
    !isUserOrganizationMembership &&
    !isTeamAgent &&
    !isTeamTool &&
    !isTeamKb &&
    !isCoarseMcp &&
    !isUserProfileOwner &&
    !isBaselineAdminSurfaceReader &&
    !isUniversalRelationship
  ) {
    throw new ApiError("tuple does not match the CAIPE OpenFGA model", 400);
  }
  return { user, relation, object };
}

export async function withOpenFgaViewAuth<T>(
  request: NextRequest,
  handler: (auth: OpenFgaAuthContext) => Promise<T>
): Promise<T> {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");
  return handler({ user, session: session as OpenFgaAuthContext["session"] });
}

export async function withOpenFgaAdminAuth<T>(
  request: NextRequest,
  handler: (auth: OpenFgaAuthContext) => Promise<T>
): Promise<T> {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  return handler({ user, session: session as OpenFgaAuthContext["session"] });
}
