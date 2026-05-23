import { NextRequest } from "next/server";
import { ApiError, getAuthFromBearerOrSession, requireRbacPermission, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getRbacCollection, type RebacRelationshipDocument } from "@/lib/rbac/mongo-collections";
import { getPolicyChangeSet, updatePolicyChangeSet } from "@/lib/rbac/policy-change-set-store";
import { validatePolicyChangeSet } from "@/lib/rbac/policy-change-validator";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";

interface RouteContext {
  params: Promise<{ changeSetId: string }>;
}

function mayRemoveResourceAdmin(relationship: UniversalRebacRelationship): boolean {
  return (
    ["manage", "administer"].includes(relationship.action) &&
    (relationship.subject.relation === "admin" || relationship.subject.relation === "owner")
  );
}

async function minimumAdminRelationshipCount(
  deletes: UniversalRebacRelationship[]
): Promise<number | undefined> {
  const candidates = deletes.filter(mayRemoveResourceAdmin);
  if (candidates.length === 0) return undefined;
  const collection = await getRbacCollection<RebacRelationshipDocument>("rebacRelationships");
  const counts = await Promise.all(
    candidates.map((relationship) =>
      collection.countDocuments({
        "resource.type": relationship.resource.type,
        "resource.id": relationship.resource.id,
        action: { $in: ["manage", "administer"] },
        "subject.relation": { $in: ["admin", "owner"] },
        status: "active",
      })
    )
  );
  return Math.min(...counts);
}

export const POST = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");

  const { changeSetId } = await context.params;
  const changeSet = await getPolicyChangeSet(changeSetId);
  if (!changeSet) {
    throw new ApiError("Policy change set not found", 404);
  }

  const validation = validatePolicyChangeSet({
    writes: changeSet.writes,
    deletes: changeSet.deletes,
    actor: { email: user.email, platformAdmin: true },
    existingAdminRelationships: await minimumAdminRelationshipCount(changeSet.deletes),
  });
  const status = validation.valid ? "validated" : "blocked";
  const updated = await updatePolicyChangeSet(changeSet.id, {
    status,
    validation,
    updated_by: user.email,
    updated_at: new Date().toISOString(),
  });

  return successResponse({ change_set: updated, validation });
});
