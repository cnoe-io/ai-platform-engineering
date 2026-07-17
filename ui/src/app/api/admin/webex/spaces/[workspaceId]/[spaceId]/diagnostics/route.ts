import { NextRequest } from "next/server";

import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import { computeWebexSpaceDiagnostics } from "@/lib/rbac/webex-space-diagnostics";
import { parseWebexSpaceRouteParams } from "@/lib/rbac/webex-space-openfga";
import { requireAvailableWebexBotPolicy } from "@/lib/webex-bot-policy";

import { withWebexSpaceRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
  return withWebexSpaceRebacViewAuth(
    request,
    async () => {
      const botId = (
        await requireAvailableWebexBotPolicy(request.nextUrl.searchParams.get("bot_id"))
      ).id;
      return successResponse(await computeWebexSpaceDiagnostics(workspaceId, spaceId, botId));
    },
    { workspaceId, spaceId },
  );
});
