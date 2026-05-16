import { NextRequest, NextResponse } from "next/server";
import { ApiError, getAuthFromBearerOrSession, requireRbacPermission, withErrorHandler } from "@/lib/api-middleware";
import { createPolicyChangeSet } from "@/lib/rbac/policy-change-set-store";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";

function relationshipArray(value: unknown, field: string): UniversalRebacRelationship[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(`${field} must be an array`, 400);
  }
  return value as UniversalRebacRelationship[];
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }

  const name = String(body.name ?? "").trim();
  if (!name) {
    throw new ApiError("name is required", 400);
  }
  const changeSet = await createPolicyChangeSet({
    name,
    description: typeof body.description === "string" ? body.description : undefined,
    writes: relationshipArray(body.writes, "writes"),
    deletes: relationshipArray(body.deletes, "deletes"),
    actorEmail: user.email,
  });

  return NextResponse.json({ success: true, data: { change_set: changeSet } }, { status: 201 });
});
