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
  listSlackChannelGrants,
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

  const channelGrants = await listSlackChannelGrants(input.workspace_id, input.channel_id);
  const channelAllowed = channelGrants.some(
    (grant) =>
      grant.resource.type === input.resource.type &&
      grant.resource.id === input.resource.id &&
      grant.actions.includes(input.action)
  );
  if (!channelAllowed) {
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
