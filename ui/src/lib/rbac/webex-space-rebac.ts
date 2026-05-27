import type {
  WebexSpaceAccessCheckResult,
  WebexSpaceGrantResourceType,
} from "@/types/webex-rebac";
import type {
  UniversalRebacRelationship,
  UniversalRebacResourceAction,
  UniversalRebacResourceRef,
  UniversalRebacSubjectRef,
  UniversalRebacSubjectType,
} from "@/types/rbac-universal";

import { checkUniversalRebacRelationship } from "./openfga";
import {
  WEBEX_SPACE_GRANT_RESOURCE_TYPES,
  webexSpaceSubjectId,
} from "./webex-space-grant-store";

const VALID_WEBEX_GRANT_SUBJECT_TYPES = new Set<UniversalRebacSubjectType>([
  "user",
  "team",
  "slack_channel",
  "webex_space",
  "external_group",
  "service_account",
]);

const VALID_WEBEX_GRANT_SUBJECT_RELATIONS = new Set<NonNullable<UniversalRebacSubjectRef["relation"]>>([
  "member",
  "admin",
  "owner",
]);

function parseSubjectRef(value: string): UniversalRebacSubjectRef | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [base, relation] = trimmed.split("#", 2);
  const [type, ...idParts] = base.split(":");
  const id = idParts.join(":");
  if (!type || !id) return null;
  if (!VALID_WEBEX_GRANT_SUBJECT_TYPES.has(type as UniversalRebacSubjectType)) return null;
  if (relation && !VALID_WEBEX_GRANT_SUBJECT_RELATIONS.has(relation as UniversalRebacSubjectRef["relation"])) {
    return null;
  }
  return {
    type: type as UniversalRebacSubjectRef["type"],
    id,
    ...(relation ? { relation: relation as UniversalRebacSubjectRef["relation"] } : {}),
  };
}

export function webexSpaceSubjectRef(
  workspaceId: string,
  spaceId: string
): UniversalRebacSubjectRef {
  return {
    type: "webex_space",
    id: webexSpaceSubjectId(workspaceId, spaceId),
  };
}

export function webexSpaceGrantRelationship(
  workspaceId: string,
  spaceId: string,
  resource: UniversalRebacResourceRef,
  action: UniversalRebacResourceAction
): UniversalRebacRelationship {
  return {
    subject: webexSpaceSubjectRef(workspaceId, spaceId),
    action,
    resource,
  };
}

// Team→space visibility tuples. Without these, the space exists in Mongo but
// no one can `can_read` it in OpenFGA, so the admin /api/admin/webex/spaces
// listing endpoint silently filters it out. Mirrors
// slackChannelTeamVisibilityRelationships for parity with the Slack surface.
export function webexSpaceTeamVisibilityRelationships(
  workspaceId: string,
  spaceId: string,
  teamSlug: string
): UniversalRebacRelationship[] {
  const spaceResource: UniversalRebacResourceRef = {
    type: "webex_space",
    id: webexSpaceSubjectId(workspaceId, spaceId),
  };
  return [
    {
      subject: { type: "team", id: teamSlug, relation: "admin" },
      action: "manage",
      resource: spaceResource,
    },
    {
      subject: { type: "team", id: teamSlug, relation: "member" },
      action: "use",
      resource: spaceResource,
    },
  ];
}

export function parseWebexSpaceGrantSubject(
  userSubject: string | undefined
): UniversalRebacSubjectRef | null {
  return userSubject ? parseSubjectRef(userSubject) : null;
}

export async function checkWebexSpaceAccess(input: {
  workspace_id: string;
  space_id: string;
  user_subject?: string;
  resource: UniversalRebacResourceRef;
  action: UniversalRebacResourceAction;
}): Promise<WebexSpaceAccessCheckResult> {
  if (!WEBEX_SPACE_GRANT_RESOURCE_TYPES.has(input.resource.type as WebexSpaceGrantResourceType)) {
    return {
      allowed: false,
      space_allowed: false,
      user_allowed: false,
      reason: "unsupported_resource",
    };
  }

  const spaceResult = await checkUniversalRebacRelationship({
    subject: webexSpaceSubjectRef(input.workspace_id, input.space_id),
    action: input.action,
    resource: input.resource,
  });
  if (!spaceResult.allowed) {
    return {
      allowed: false,
      space_allowed: false,
      user_allowed: false,
      reason: "missing_space_grant",
    };
  }

  const subject = parseWebexSpaceGrantSubject(input.user_subject);
  if (!subject) {
    return {
      allowed: false,
      space_allowed: true,
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
    space_allowed: true,
    user_allowed: Boolean(userResult.allowed),
    reason: userResult.allowed ? "allowed" : "missing_user_grant",
  };
}
