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
    // bypassForOrgAdmin so an org admin can read a channel that has no
    // per-channel grants yet — e.g. one just imported from config and not yet
    // assigned to a team.
    await requireResourcePermission(session, {
      type: "slack_channel",
      id: slackChannelSubjectId(target.workspaceId, target.channelId),
      action: "read",
    }, { bypassForOrgAdmin: true });
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
    // bypassForOrgAdmin so an org admin can onboard/assign-team a channel that
    // doesn't yet have per-channel manage grants (without it, an imported
    // channel 403s before it can be assigned to a team).
    await requireResourcePermission(session, {
      type: "slack_channel",
      id: slackChannelSubjectId(target.workspaceId, target.channelId),
      action: "manage",
    }, { bypassForOrgAdmin: true });
  } else {
    await requireAdminSurfaceManage(session, "slack");
  }
  return handler();
}
