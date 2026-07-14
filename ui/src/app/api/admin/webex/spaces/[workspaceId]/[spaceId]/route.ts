// assisted-by Codex Codex-sonnet-4-6
import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { parseWebexSpaceRouteParams } from "@/lib/rbac/webex-space-openfga";
import {
  deleteWebexSpaceState,
  WEBEX_SPACE_USABLE_OBJECT_TYPES,
} from "@/lib/rbac/webex-space-delete";
import { requireAvailableWebexBotId } from "@/lib/webex-bot-catalog";

import { withWebexSpaceRebacManageAuth } from "../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export { WEBEX_SPACE_USABLE_OBJECT_TYPES };

export const DELETE = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);

  return withWebexSpaceRebacManageAuth(request, async () => {
    const botId = requireAvailableWebexBotId(request.nextUrl.searchParams.get("bot_id"));
    let deleted;
    try {
      deleted = await deleteWebexSpaceState({
        workspaceId,
        spaceId,
        botId,
        requireOpenFga: true,
      });
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? `OpenFGA tuple delete failed: ${error.message}` : "OpenFGA tuple delete failed",
        502,
      );
    }

    return successResponse({
      deleted: {
        workspace_id: workspaceId,
        space_id: spaceId,
        bot_id: botId,
        ...deleted,
      },
    });
  }, { workspaceId, spaceId });
});
