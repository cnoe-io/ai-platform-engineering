import type {
  SlackChannelAccessCheckResult,
  SlackChannelGrantResourceType,
} from "@/types/slack-rebac";
import type {
  UniversalRebacRelationship,
  UniversalRebacResourceAction,
  UniversalRebacResourceRef,
} from "@/types/rbac-universal";

import { checkUniversalRebacRelationship } from "./openfga";
import {
  SLACK_CHANNEL_GRANT_RESOURCE_TYPES,
  slackChannelSubjectId,
} from "./slack-channel-grant-store";

export function slackChannelGrantRelationship(
  workspaceId: string,
  channelId: string,
  resource: UniversalRebacResourceRef,
  action: UniversalRebacResourceAction
): UniversalRebacRelationship {
  return {
    subject: { type: "slack_channel", id: slackChannelSubjectId(workspaceId, channelId) },
    action,
    resource,
  };
}

// Team→channel visibility tuples. Without these, the channel exists in Mongo
// but no one can `can_read` it in OpenFGA, so the admin /api/admin/slack/channels
// listing endpoint silently filters it out. Pair of tuples:
//   team:<slug>#admin  -> manage (relation `manager`) -> slack_channel
//   team:<slug>#member -> use    (relation `user`)    -> slack_channel
// `manager` covers can_read/can_manage/can_audit; `user` covers can_use which
// resolves through to can_read. Matches the shape already written by
// `ui/src/app/api/admin/teams/[id]/slack-channels/route.ts` so admin-PUT and
// onboarding-defaults converge on the same OpenFGA tuple set.
export function slackChannelTeamVisibilityRelationships(
  workspaceId: string,
  channelId: string,
  teamSlug: string
): UniversalRebacRelationship[] {
  const channelResource: UniversalRebacResourceRef = {
    type: "slack_channel",
    id: slackChannelSubjectId(workspaceId, channelId),
  };
  return [
    {
      subject: { type: "team", id: teamSlug, relation: "admin" },
      action: "manage",
      resource: channelResource,
    },
    {
      subject: { type: "team", id: teamSlug, relation: "member" },
      action: "use",
      resource: channelResource,
    },
  ];
}

export async function checkSlackChannelAccess(input: {
  workspace_id: string;
  channel_id: string;
  resource: UniversalRebacResourceRef;
  action: UniversalRebacResourceAction;
}): Promise<SlackChannelAccessCheckResult> {
  if (!SLACK_CHANNEL_GRANT_RESOURCE_TYPES.has(input.resource.type as SlackChannelGrantResourceType)) {
    return {
      allowed: false,
      channel_allowed: false,
      reason: "unsupported_action",
    };
  }

  const channelResult = await checkUniversalRebacRelationship({
    subject: { type: "slack_channel", id: slackChannelSubjectId(input.workspace_id, input.channel_id) },
    action: input.action,
    resource: input.resource,
  });

  return {
    allowed: channelResult.allowed,
    channel_allowed: channelResult.allowed,
    reason: channelResult.allowed ? "allowed" : "missing_channel_grant",
  };
}
