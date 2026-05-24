import type {
  SlackChannelAccessCheckResult,
  SlackChannelGrantResourceType,
} from "@/types/slack-rebac";
import type {
  UniversalRebacRelationship,
  UniversalRebacResourceAction,
  UniversalRebacResourceRef,
  UniversalRebacSubjectRef,
} from "@/types/rbac-universal";

import { checkUniversalRebacRelationship } from "./openfga";
import {
  SLACK_CHANNEL_GRANT_RESOURCE_TYPES,
  slackChannelSubjectId,
} from "./slack-channel-grant-store";

function parseSubjectRef(value: string): UniversalRebacSubjectRef | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [base, relation] = trimmed.split("#", 2);
  const [type, ...idParts] = base.split(":");
  const id = idParts.join(":");
  if (!type || !id) return null;
  return {
    type: type as UniversalRebacSubjectRef["type"],
    id,
    ...(relation ? { relation: relation as UniversalRebacSubjectRef["relation"] } : {}),
  };
}

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

export function parseSlackChannelGrantSubject(
  userSubject: string | undefined
): UniversalRebacSubjectRef | null {
  return userSubject ? parseSubjectRef(userSubject) : null;
}

export async function checkSlackChannelAccess(input: {
  workspace_id: string;
  channel_id: string;
  user_subject?: string;
  resource: UniversalRebacResourceRef;
  action: UniversalRebacResourceAction;
}): Promise<SlackChannelAccessCheckResult> {
  if (!SLACK_CHANNEL_GRANT_RESOURCE_TYPES.has(input.resource.type as SlackChannelGrantResourceType)) {
    return {
      allowed: false,
      channel_allowed: false,
      user_allowed: false,
      reason: "unsupported_action",
    };
  }

  const channelResult = await checkUniversalRebacRelationship({
    subject: { type: "slack_channel", id: slackChannelSubjectId(input.workspace_id, input.channel_id) },
    action: input.action,
    resource: input.resource,
  });
  if (!channelResult.allowed) {
    return {
      allowed: false,
      channel_allowed: false,
      user_allowed: false,
      reason: "missing_channel_grant",
    };
  }

  const subject = parseSlackChannelGrantSubject(input.user_subject);
  if (!subject) {
    return {
      allowed: false,
      channel_allowed: true,
      user_allowed: false,
      reason: "missing_user_grant",
    };
  }

  const userResult = await checkUniversalRebacRelationship({
    subject,
    action: input.action,
    resource: input.resource,
  });

  return {
    allowed: Boolean(userResult.allowed),
    channel_allowed: true,
    user_allowed: Boolean(userResult.allowed),
    reason: userResult.allowed ? "allowed" : "missing_user_grant",
  };
}
