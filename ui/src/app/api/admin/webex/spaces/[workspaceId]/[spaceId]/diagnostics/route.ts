import { NextRequest } from "next/server";

import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import { computeWebexSpaceDiagnostics } from "@/lib/rbac/webex-space-diagnostics";
import { parseWebexSpaceRouteParams } from "@/lib/rbac/webex-space-openfga";

import { withWebexSpaceRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
  return withWebexSpaceRebacViewAuth(
    request,
    async () => successResponse(await computeWebexSpaceDiagnostics(workspaceId, spaceId)),
    { workspaceId, spaceId },
  );
});
