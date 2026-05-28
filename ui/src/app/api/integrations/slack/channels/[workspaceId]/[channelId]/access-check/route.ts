import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { checkSlackChannelAccess } from "@/lib/rbac/slack-channel-rebac";
import { slackChannelSubjectId } from "@/lib/rbac/slack-channel-grant-store";
import type { UniversalRebacResourceAction, UniversalRebacResourceRef } from "@/types/rbac-universal";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

function parseResource(value: unknown): UniversalRebacResourceRef {
  if (!value || typeof value !== "object") {
    throw new ApiError("resource is required", 400);
  }
  const resource = value as Record<string, unknown>;
  const type = typeof resource.type === "string" ? resource.type.trim() : "";
  const id = typeof resource.id === "string" ? resource.id.trim() : "";
  if (!type || !id) {
    throw new ApiError("resource.type and resource.id are required", 400);
  }
  return { type: type as UniversalRebacResourceRef["type"], id };
}

export const POST = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { session } = await getAuthFromBearerOrSession(request);

  const { workspaceId, channelId } = await context.params;
  await requireResourcePermission(session, {
    type: "slack_channel",
    id: slackChannelSubjectId(workspaceId, channelId),
    action: "read",
  }, { bypassForOrgAdmin: true });

  const body = (await request.json()) as Record<string, unknown>;
  const action =
    typeof body.action === "string" && body.action.trim()
      ? (body.action.trim() as UniversalRebacResourceAction)
      : null;
  if (!action) {
    throw new ApiError("action is required", 400);
  }

  const result = await checkSlackChannelAccess({
    workspace_id: workspaceId,
    channel_id: channelId,
    user_subject: typeof body.user_subject === "string" ? body.user_subject : undefined,
    resource: parseResource(body.resource),
    action,
  });

  return successResponse(result);
});
