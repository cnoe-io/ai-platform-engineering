import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { computeSlackChannelDiagnostics } from "@/lib/rbac/slack-channel-diagnostics";

import { withSlackChannelRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { workspaceId, channelId } = await context.params;
  return withSlackChannelRebacViewAuth(
    request,
    async () => {
      const diagnostics = await computeSlackChannelDiagnostics(workspaceId, channelId);
      return successResponse(diagnostics);
    },
    { workspaceId, channelId },
  );
});
