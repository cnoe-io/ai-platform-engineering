import { ApiError,getAuthFromBearerOrSession,requireRbacPermission,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { explainAccess } from "@/lib/rbac/access-explainer";
import { logOpenFgaRebacAuditEvent } from "@/lib/rbac/audit";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";
import { NextRequest } from "next/server";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");
  let body: { relationship?: UniversalRebacRelationship };
  try {
    body = (await request.json()) as { relationship?: UniversalRebacRelationship };
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }
  if (!body.relationship) {
    throw new ApiError("relationship is required", 400);
  }

  const result = await explainAccess(body.relationship);
  logOpenFgaRebacAuditEvent({
    tenantId: session?.org ?? "default",
    sub: session?.sub ?? user.email,
    operation: "explain_access",
    outcome: result.allowed ? "allow" : "deny",
    reasonCode: result.allowed ? "OK" : "DENY_NO_CAPABILITY",
    resourceRef: `${result.tuple.user} ${result.tuple.relation} ${result.tuple.object}`,
    email: user.email,
  });

  return successResponse(result);
});
