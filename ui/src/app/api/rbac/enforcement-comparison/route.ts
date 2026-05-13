import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { compareRoleAndRebacEnforcement } from "@/lib/rbac/enforcement-comparison";
import { listRebacEnforcementStatuses } from "@/lib/rbac/enforcement-status";
import type {
  UniversalRebacResourceAction,
  UniversalRebacResourceRef,
  UniversalRebacSubjectRef,
} from "@/types/rbac-universal";

function parseSubject(value: unknown): UniversalRebacSubjectRef {
  if (!value || typeof value !== "object") {
    throw new ApiError("subject is required", 400);
  }
  const subject = value as Record<string, unknown>;
  const type = typeof subject.type === "string" ? subject.type.trim() : "";
  const id = typeof subject.id === "string" ? subject.id.trim() : "";
  if (!type || !id) {
    throw new ApiError("subject.type and subject.id are required", 400);
  }
  return {
    type: type as UniversalRebacSubjectRef["type"],
    id,
    ...(typeof subject.relation === "string" && subject.relation.trim()
      ? { relation: subject.relation.trim() as UniversalRebacSubjectRef["relation"] }
      : {}),
  };
}

function parseResource(value: unknown): UniversalRebacResourceRef {
  if (!value || typeof value !== "object") {
    throw new ApiError("resource is required", 400);
  }
  const resource = value as Record<string, unknown>;
  const type = typeof resource.type === "string" ? resource.type.trim() : "";
  const id = typeof resource.id === "string" ? resource.id.trim() : "";
  if (!type || !id) {
    throw new ApiError("resource.type and resource.id are required", 400);
  }
  return { type: type as UniversalRebacResourceRef["type"], id };
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const body = (await request.json()) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!action) {
    throw new ApiError("action is required", 400);
  }
  const realmRoles = Array.isArray(body.realm_roles)
    ? body.realm_roles.map((role) => String(role)).filter(Boolean)
    : [];

  const result = await compareRoleAndRebacEnforcement({
    subject: parseSubject(body.subject),
    resource: parseResource(body.resource),
    action: action as UniversalRebacResourceAction,
    realm_roles: realmRoles,
    enforcementStatuses: await listRebacEnforcementStatuses(),
  });

  return successResponse(result);
});
