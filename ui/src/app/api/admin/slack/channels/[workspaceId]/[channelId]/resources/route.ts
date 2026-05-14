import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { writeOpenFgaTuples } from "@/lib/rbac/openfga";
import {
  replaceSlackChannelGrants,
  listSlackChannelGrants,
  SLACK_CHANNEL_GRANT_RESOURCE_TYPES,
  type SlackChannelGrantInput,
} from "@/lib/rbac/slack-channel-grant-store";
import { slackChannelGrantRelationship } from "@/lib/rbac/slack-channel-rebac";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import type { UniversalRebacResourceAction } from "@/types/rbac-universal";
import type { SlackChannelGrantResourceType } from "@/types/slack-rebac";

import { withSlackChannelRebacManageAuth, withSlackChannelRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

function parseGrant(value: unknown, index: number): Omit<SlackChannelGrantInput, "workspace_id" | "channel_id"> {
  if (!value || typeof value !== "object") {
    throw new ApiError(`grants[${index}] must be an object`, 400);
  }
  const input = value as Record<string, unknown>;
  const resource = input.resource as Record<string, unknown> | undefined;
  const type = typeof resource?.type === "string" ? resource.type.trim() : "";
  const id = typeof resource?.id === "string" ? resource.id.trim() : "";
  if (!SLACK_CHANNEL_GRANT_RESOURCE_TYPES.has(type as SlackChannelGrantResourceType) || !id) {
    throw new ApiError(`grants[${index}].resource must include a supported type and id`, 400);
  }
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new ApiError(`grants[${index}].actions must be a non-empty array`, 400);
  }
  const actions = input.actions.map((action) => String(action).trim()).filter(Boolean);
  return {
    resource: { type: type as SlackChannelGrantResourceType, id },
    actions: actions as UniversalRebacResourceAction[],
  };
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) =>
  withSlackChannelRebacViewAuth(request, async () => {
    const { workspaceId, channelId } = await context.params;
    const grants = await listSlackChannelGrants(workspaceId, channelId);
    return successResponse({ grants });
  })
);

export const PUT = withErrorHandler(async (request: NextRequest, context: RouteContext) =>
  withSlackChannelRebacManageAuth(request, async () => {
    const { workspaceId, channelId } = await context.params;
    const body = (await request.json()) as { grants?: unknown };
    if (!Array.isArray(body.grants)) {
      throw new ApiError("grants must be an array", 400);
    }

    const actor = "api";
    const grants = body.grants.map((grant, index) => ({
      workspace_id: workspaceId,
      channel_id: channelId,
      ...parseGrant(grant, index),
      created_by: actor,
    }));
    const saved = await replaceSlackChannelGrants(workspaceId, channelId, grants, actor);
    const writes = grants.flatMap((grant) =>
      grant.actions.map((action) =>
        slackChannelGrantRelationship(workspaceId, channelId, grant.resource, action)
      )
    );
    const openfga = await writeOpenFgaTuples(buildUniversalRebacTupleDiff({ writes, deletes: [] }))
      .catch((error) => ({
        enabled: false,
        writes: 0,
        deletes: 0,
        error: error instanceof Error ? error.message : "OpenFGA tuple write failed",
      }));

    return successResponse({ grants: saved, openfga });
  })
);
