import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { readOpenFgaTuples, writeOpenFgaTuples } from "@/lib/rbac/openfga";
import {
  replaceSlackChannelGrants,
  SLACK_CHANNEL_GRANT_RESOURCE_TYPES,
  slackChannelSubjectId,
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

function agentIdFromObject(object: string): string | null {
  if (!object.startsWith("agent:")) return null;
  const agentId = object.slice("agent:".length).trim();
  return agentId || null;
}

async function listOpenFgaAgentIds(workspaceId: string, channelId: string): Promise<string[]> {
  const subject = `slack_channel:${slackChannelSubjectId(workspaceId, channelId)}`;
  const seen = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const result = await readOpenFgaTuples({
      tuple: { user: subject, relation: "user" },
      pageSize: 100,
      ...(continuationToken ? { continuationToken } : {}),
    });
    for (const tuple of result.tuples) {
      const agentId = agentIdFromObject(tuple.key.object);
      if (agentId) seen.add(agentId);
    }
    continuationToken = result.continuationToken;
  } while (continuationToken);
  return Array.from(seen).sort();
}

async function listOpenFgaAgentGrants(workspaceId: string, channelId: string): Promise<SlackChannelGrantInput[]> {
  const agentIds = await listOpenFgaAgentIds(workspaceId, channelId);
  return agentIds
    .map((agentId) => ({
      workspace_id: workspaceId,
      channel_id: channelId,
      resource: { type: "agent" as const, id: agentId },
      actions: ["use" as const],
    }));
}

async function writeRequiredOpenFgaTuples(
  writes: ReturnType<typeof slackChannelGrantRelationship>[],
  deletes: ReturnType<typeof slackChannelGrantRelationship>[]
) {
  try {
    const result = await writeOpenFgaTuples(buildUniversalRebacTupleDiff({ writes, deletes }));
    if (!result.enabled) {
      throw new Error("OpenFGA is not configured");
    }
    return result;
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? `OpenFGA tuple write failed: ${error.message}` : "OpenFGA tuple write failed",
      502
    );
  }
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
    const grants = await listOpenFgaAgentGrants(workspaceId, channelId);
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
    const existingAgentIds = await listOpenFgaAgentIds(workspaceId, channelId);
    const nextAgentIds = grants
      .filter((grant) => grant.resource.type === "agent" && grant.actions.includes("use"))
      .map((grant) => grant.resource.id);
    const writes = grants.flatMap((grant) =>
      grant.actions.map((action) =>
        slackChannelGrantRelationship(workspaceId, channelId, grant.resource, action)
      )
    );
    const deletes = existingAgentIds
      .filter((agentId) => !nextAgentIds.includes(agentId))
      .map((agentId) =>
        slackChannelGrantRelationship(workspaceId, channelId, { type: "agent", id: agentId }, "use")
      );
    const openfga = await writeRequiredOpenFgaTuples(writes, deletes);
    const saved = await replaceSlackChannelGrants(workspaceId, channelId, grants, actor);

    return successResponse({ grants: saved, openfga });
  })
);
