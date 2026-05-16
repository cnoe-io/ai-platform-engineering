import { NextRequest } from "next/server";
import { ApiError, getAuthFromBearerOrSession, requireRbacPermission, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { logPolicyChangeAuditEvent } from "@/lib/rbac/audit";
import { getRbacCollection, type RebacRelationshipDocument } from "@/lib/rbac/mongo-collections";
import { getPolicyChangeSet, updatePolicyChangeSet } from "@/lib/rbac/policy-change-set-store";
import { validatePolicyChangeSet } from "@/lib/rbac/policy-change-validator";
import { writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
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

function relationshipFilter(relationship: UniversalRebacRelationship) {
  return {
    "subject.type": relationship.subject.type,
    "subject.id": relationship.subject.id,
    "subject.relation": relationship.subject.relation,
    action: relationship.action,
    "resource.type": relationship.resource.type,
    "resource.id": relationship.resource.id,
  };
}

async function recordRelationshipProvenance(
  changeSetId: string,
  actorEmail: string,
  writes: UniversalRebacRelationship[],
  deletes: UniversalRebacRelationship[]
): Promise<void> {
  const collection = await getRbacCollection<RebacRelationshipDocument>("rebacRelationships");
  const now = new Date().toISOString();

  await Promise.all([
    ...writes.map((relationship) =>
      collection.updateOne(
        relationshipFilter(relationship),
        {
          $set: {
            ...relationship,
            source_type: "manual",
            source_id: changeSetId,
            status: "active",
            created_by: actorEmail,
            created_at: now,
          },
        },
        { upsert: true }
      )
    ),
    ...deletes.map((relationship) =>
      collection.updateOne(relationshipFilter(relationship), {
        $set: {
          status: "revoked",
          revoked_by: actorEmail,
          revoked_at: now,
        },
      })
    ),
  ]);
}

export const POST = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");

  const { changeSetId } = await context.params;
  const changeSet = await getPolicyChangeSet(changeSetId);
  if (!changeSet) {
    throw new ApiError("Policy change set not found", 404);
  }
  if (changeSet.status === "applied") {
    throw new ApiError("Policy change set has already been applied", 409);
  }

  const validation = validatePolicyChangeSet({
    writes: changeSet.writes,
    deletes: changeSet.deletes,
    actor: { email: user.email, platformAdmin: true },
    existingAdminRelationships: await minimumAdminRelationshipCount(changeSet.deletes),
  });
  if (!validation.valid) {
    const updated = await updatePolicyChangeSet(changeSet.id, {
      status: "blocked",
      validation,
      updated_by: user.email,
      updated_at: new Date().toISOString(),
    });
    return successResponse({ change_set: updated, validation, applied: false });
  }

  const tupleDiff = buildUniversalRebacTupleDiff({
    writes: validation.grants,
    deletes: validation.revocations,
  });
  const result = await writeOpenFgaTuples(tupleDiff);
  await recordRelationshipProvenance(changeSet.id, user.email, validation.grants, validation.revocations);
  const now = new Date().toISOString();
  const updated = await updatePolicyChangeSet(changeSet.id, {
    status: "applied",
    validation,
    applied_by: user.email,
    applied_at: now,
    updated_by: user.email,
    updated_at: now,
  });

  logPolicyChangeAuditEvent({
    tenantId: "default",
    sub: session?.sub ?? user.email,
    operation: "apply_change_set",
    resourceRef: `policy_change_set:${changeSet.id}`,
    email: user.email,
  });

  return successResponse({ change_set: updated, validation, result, applied: true });
});
