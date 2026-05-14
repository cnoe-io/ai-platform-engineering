import { NextRequest } from "next/server";
import { ApiError, getAuthFromBearerOrSession, requireRbacPermission, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getRbacCollection, type RebacRelationshipDocument } from "@/lib/rbac/mongo-collections";
import { readOpenFgaTuples, type OpenFgaTuple } from "@/lib/rbac/openfga";
import { isUniversalRebacResourceType } from "@/lib/rbac/relationship-validator";

interface RouteContext {
  params: Promise<{ type: string; id: string }>;
}

function provenanceKey(row: RebacRelationshipDocument): string {
  return `${row.subject.type}:${row.subject.id}#${row.subject.relation ?? ""}:${row.action}:${row.resource.type}:${row.resource.id}`;
}

function tupleProvenanceKey(tuple: OpenFgaTuple): string {
  const [subjectType, subjectRest = ""] = tuple.key.user.split(":", 2);
  const [subjectId, subjectRelation = ""] = subjectRest.split("#", 2);
  const [resourceType, resourceId = ""] = tuple.key.object.split(":", 2);
  return `${subjectType}:${subjectId}#${subjectRelation}:${tuple.key.relation.replace(/^can_/, "")}:${resourceType}:${resourceId}`;
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const { type, id } = await context.params;
  if (!isUniversalRebacResourceType(type)) {
    throw new ApiError("Unsupported ReBAC resource type", 400);
  }

  const object = `${type}:${id}`;
  const [openFga, provenanceRows] = await Promise.all([
    readOpenFgaTuples({ tuple: { object }, pageSize: 100 }),
    (await getRbacCollection<RebacRelationshipDocument>("rebacRelationships"))
      .find({ "resource.type": type, "resource.id": id, status: { $ne: "revoked" } })
      .sort({ created_at: -1 })
      .toArray(),
  ]);

  const provenanceByKey = new Map(provenanceRows.map((row) => [provenanceKey(row), row]));
  const relationships = openFga.tuples.map((tuple) => {
    const provenance = provenanceByKey.get(tupleProvenanceKey(tuple));
    return {
      tuple: tuple.key,
      timestamp: tuple.timestamp,
      provenance: provenance
        ? {
            source_type: provenance.source_type,
            source_id: provenance.source_id,
            status: provenance.status,
            created_by: provenance.created_by,
            created_at: provenance.created_at,
          }
        : null,
    };
  });

  return successResponse({
    resource: { type, id, object },
    relationships,
    continuation_token: openFga.continuationToken,
  });
});
