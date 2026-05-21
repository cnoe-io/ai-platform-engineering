import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession } from "@/lib/api-middleware";
import { requireAdminSurfaceManage } from "@/lib/rbac/require-openfga";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { slackChannelSubjectId } from "@/lib/rbac/slack-channel-grant-store";

interface SlackChannelTarget {
  workspaceId: string;
  channelId: string;
}

export async function withSlackChannelRebacViewAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>,
  target?: SlackChannelTarget
): Promise<T> {
  const { session } = await getAuthFromBearerOrSession(request);
  if (target) {
    await requireResourcePermission(session, {
      type: "slack_channel",
      id: slackChannelSubjectId(target.workspaceId, target.channelId),
      action: "read",
    }, { allowAdminBypass: true });
  } else {
    await requireAdminSurfaceManage(session, "slack");
  }
  return handler();
}

export async function withSlackChannelRebacManageAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>,
  target?: SlackChannelTarget
): Promise<T> {
  const { session } = await getAuthFromBearerOrSession(request);
  if (target) {
    await requireResourcePermission(session, {
      type: "slack_channel",
      id: slackChannelSubjectId(target.workspaceId, target.channelId),
      action: "manage",
    }, { allowAdminBypass: true });
  } else {
    await requireAdminSurfaceManage(session, "slack");
  }
  return handler();
}
