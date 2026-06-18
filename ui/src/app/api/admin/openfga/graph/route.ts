import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import { logOpenFgaRebacAuditEvent } from "@/lib/rbac/audit";
import { queryRebacGraph } from "@/lib/rbac/rebac-graph";
import { NextRequest } from "next/server";
import { withOpenFgaViewAuth } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async ({ user, session }) => {
    const teamSlug = request.nextUrl.searchParams.get("team")?.trim() || undefined;
    const subject = request.nextUrl.searchParams.get("subject")?.trim() || undefined;
    const layer = request.nextUrl.searchParams.get("layer")?.trim() || undefined;
    const maxTuples = Math.min(
      Math.max(Number.parseInt(request.nextUrl.searchParams.get("limit") || "1000", 10), 1),
      1000
    );
    const graph = await queryRebacGraph({ team: teamSlug, subject, layer, limit: maxTuples });
    logOpenFgaRebacAuditEvent({
      tenantId: session?.org ?? "default",
      sub: session?.sub ?? user.email,
      operation: "query_graph",
      resourceRef: `openfga_graph:${JSON.stringify({ team: teamSlug, subject, limit: maxTuples })}`,
      email: user.email,
    });
    return successResponse(graph);
  })
);
