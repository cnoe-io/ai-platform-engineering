import { NextRequest } from "next/server";
import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { writeOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { validateTupleKey, withOpenFgaAdminAuth } from "../_lib";

type ResourceType = "agent" | "tool" | "knowledge_base";
type Operation = "grant" | "revoke";

const RELATIONS_BY_TYPE: Record<ResourceType, string[]> = {
  agent: ["can_use", "can_manage"],
  tool: ["can_call"],
  knowledge_base: ["can_read", "can_ingest", "can_admin"],
};

function parseBody(body: unknown): {
  teamSlug: string;
  resourceType: ResourceType;
  resourceId: string;
  relation: string;
  operation: Operation;
} {
  const value = body as Partial<{
    teamSlug: string;
    resourceType: ResourceType;
    resourceId: string;
    relation: string;
    operation: Operation;
  }>;
  const teamSlug = value.teamSlug?.trim();
  const resourceType = value.resourceType;
  const resourceId = value.resourceId?.trim();
  const relation = value.relation?.trim();
  const operation = value.operation ?? "grant";
  if (!teamSlug || !resourceType || !resourceId || !relation) {
    throw new ApiError("teamSlug, resourceType, resourceId, and relation are required", 400);
  }
  if (!["agent", "tool", "knowledge_base"].includes(resourceType)) {
    throw new ApiError("unsupported resourceType", 400);
  }
  if (!RELATIONS_BY_TYPE[resourceType].includes(relation)) {
    throw new ApiError(`relation ${relation} is not valid for ${resourceType}`, 400);
  }
  if (!["grant", "revoke"].includes(operation)) {
    throw new ApiError("operation must be grant or revoke", 400);
  }
  return { teamSlug, resourceType, resourceId, relation, operation };
}

export const POST = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }

    const parsed = parseBody(body);
    const tuple: OpenFgaTupleKey = validateTupleKey({
      user: `team:${parsed.teamSlug}#member`,
      relation: parsed.relation,
      object: `${parsed.resourceType}:${parsed.resourceId}`,
    });

    const result = await writeOpenFgaTuples({
      writes: parsed.operation === "grant" ? [tuple] : [],
      deletes: parsed.operation === "revoke" ? [tuple] : [],
    });

    return successResponse({ tuple, operation: parsed.operation, result });
  })
);
