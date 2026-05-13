import { NextRequest } from "next/server";
import { getAuthFromBearerOrSession, requireRbacPermission, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { logGraphQueryAuditEvent } from "@/lib/rbac/audit";
import { queryRebacGraph } from "@/lib/rbac/rebac-graph";

function numberParam(value: string | null, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");
  const params = request.nextUrl.searchParams;
  const graph = await queryRebacGraph({
    team: params.get("team")?.trim() || undefined,
    subject: params.get("subject")?.trim() || undefined,
    resourceType: params.get("resource_type")?.trim() || undefined,
    resourceId: params.get("resource_id")?.trim() || undefined,
    slackChannel: params.get("slack_channel")?.trim() || undefined,
    limit: numberParam(params.get("limit"), 1000),
    continuationToken: params.get("continuation_token") || undefined,
  });

  logGraphQueryAuditEvent({
    tenantId: "default",
    sub: session?.sub ?? user.email,
    operation: "query_graph",
    resourceRef: `rebac_graph:${JSON.stringify(graph.scope)}`,
    email: user.email,
  });

  return successResponse(graph);
});
