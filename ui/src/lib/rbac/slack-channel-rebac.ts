import type {
UniversalRebacRelationship,
UniversalRebacResourceAction,
UniversalRebacResourceRef,
} from "@/types/rbac-universal";
import type {
SlackChannelAccessCheckResult,
SlackChannelGrantResourceType,
} from "@/types/slack-rebac";

import { instantiatePolicyRelationships } from "./authorization-policy-catalog";
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

// Materializes policy `slack_channel_team_assignment_v1`.
// assisted-by Codex Codex-sonnet-4-6
export function slackChannelTeamVisibilityRelationships(
  workspaceId: string,
  channelId: string,
  teamSlug: string
): UniversalRebacRelationship[] {
  return instantiatePolicyRelationships("slack_channel_team_assignment_v1", {
    teamSlug,
    slackChannelId: slackChannelSubjectId(workspaceId, channelId),
  });
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
