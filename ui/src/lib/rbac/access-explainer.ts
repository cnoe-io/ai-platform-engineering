import type { UniversalRebacRelationship } from "@/types/rbac-universal";

import { getRbacCollection, type RebacRelationshipDocument } from "./mongo-collections";
import { checkUniversalRebacRelationship } from "./openfga";
import { buildOpenFgaTuple } from "./tuple-builders";

export interface AccessExplanation {
  reason: "relationship_allowed" | "missing_allow_relationship";
  path: Array<{
    source_type: RebacRelationshipDocument["source_type"];
    source_id?: string;
    status: RebacRelationshipDocument["status"];
    created_by?: string;
    created_at?: string;
  }>;
  missing: string[];
}

export interface AccessExplanationResult {
  relationship: UniversalRebacRelationship;
  tuple: ReturnType<typeof buildOpenFgaTuple>;
  allowed: boolean;
  explanation: AccessExplanation;
}

function relationshipFilter(relationship: UniversalRebacRelationship) {
  return {
    "subject.type": relationship.subject.type,
    "subject.id": relationship.subject.id,
    "subject.relation": relationship.subject.relation,
    action: relationship.action,
    "resource.type": relationship.resource.type,
    "resource.id": relationship.resource.id,
    status: "active",
  };
}

export async function explainAccess(
  relationship: UniversalRebacRelationship
): Promise<AccessExplanationResult> {
  const tuple = buildOpenFgaTuple(relationship);
  const [decision, provenance] = await Promise.all([
    checkUniversalRebacRelationship(relationship),
    (await getRbacCollection<RebacRelationshipDocument>("rebacRelationships")).findOne(
      relationshipFilter(relationship) as never
    ),
  ]);

  return {
    relationship,
    tuple,
    allowed: decision.allowed,
    explanation: decision.allowed
      ? {
          reason: "relationship_allowed",
          path: provenance
            ? [
                {
                  source_type: provenance.source_type,
                  source_id: provenance.source_id,
                  status: provenance.status,
                  created_by: provenance.created_by,
                  created_at: provenance.created_at,
                },
              ]
            : [],
          missing: [],
        }
      : {
          reason: "missing_allow_relationship",
          path: [],
          missing: [`${tuple.user} ${tuple.relation} ${tuple.object}`],
        },
  };
}
