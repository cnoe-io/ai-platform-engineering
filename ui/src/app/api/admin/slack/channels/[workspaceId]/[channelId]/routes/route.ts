import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { readOpenFgaTuples, writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { slackChannelSubjectId } from "@/lib/rbac/slack-channel-grant-store";
import {
  deleteSlackChannelAgentRoute,
  listSlackChannelAgentRoutes,
  replaceSlackChannelAgentRoutes,
  type SlackChannelAgentRouteInput,
} from "@/lib/rbac/slack-channel-route-store";
import { slackChannelGrantRelationship } from "@/lib/rbac/slack-channel-rebac";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";
import type {
  SlackChannelAgentRoute,
  SlackRouteEscalationConfig,
  SlackRouteSideConfig,
} from "@/types/slack-rebac";

import { withSlackChannelRebacManageAuth, withSlackChannelRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

function agentIdFromObject(object: string): string | null {
  if (!object.startsWith("agent:")) return null;
  const agentId = object.slice("agent:".length).trim();
  return agentId || null;
}

async function listOpenFgaChannelAgentIds(workspaceId: string, channelId: string): Promise<string[]> {
  const subject = `slack_channel:${slackChannelSubjectId(workspaceId, channelId)}`;
  const seen = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const result = await readOpenFgaTuples({
      pageSize: 100,
      ...(continuationToken ? { continuationToken } : {}),
    });
    for (const tuple of result.tuples) {
      if (tuple.key.user !== subject || tuple.key.relation !== "user") continue;
      const agentId = agentIdFromObject(tuple.key.object);
      if (agentId) seen.add(agentId);
    }
    continuationToken = result.continuationToken;
  } while (continuationToken);
  return Array.from(seen);
}

async function writeRequiredOpenFgaTuples(
  writes: UniversalRebacRelationship[],
  deletes: UniversalRebacRelationship[]
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

function defaultRouteForAgent(
  workspaceId: string,
  channelId: string,
  agentId: string
): SlackChannelAgentRoute {
  const now = new Date().toISOString();
  return {
    workspace_id: workspaceId,
    channel_id: channelId,
    agent_id: agentId,
    enabled: true,
    priority: 100,
    users: { enabled: true, listen: "mention" },
    source_type: "manual",
    status: "active",
    created_at: now,
    updated_at: now,
  };
}

function mergeOpenFgaAgentsWithMetadata(
  workspaceId: string,
  channelId: string,
  agentIds: string[],
  metadataRoutes: SlackChannelAgentRoute[]
): SlackChannelAgentRoute[] {
  const metadataByAgentId = new Map(metadataRoutes.map((route) => [route.agent_id, route]));
  return agentIds
    .map((agentId) => metadataByAgentId.get(agentId) ?? defaultRouteForAgent(workspaceId, channelId, agentId))
    .sort((left, right) => left.priority - right.priority || left.agent_id.localeCompare(right.agent_id));
}

function parseSideConfig(value: unknown, field: string): SlackRouteSideConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new ApiError(`routes[].${field} must be an object`, 400);
  }
  const input = value as Record<string, unknown>;
  return {
    ...(input.enabled !== undefined ? { enabled: Boolean(input.enabled) } : {}),
    ...(typeof input.listen === "string" ? { listen: input.listen as SlackRouteSideConfig["listen"] } : {}),
    ...(Array.isArray(input.user_list) ? { user_list: input.user_list.map(String) } : {}),
    ...(Array.isArray(input.bot_list) ? { bot_list: input.bot_list.map(String) } : {}),
    ...(input.overthink && typeof input.overthink === "object"
      ? { overthink: { enabled: Boolean((input.overthink as Record<string, unknown>).enabled) } }
      : {}),
  };
}

function parseEscalation(value: unknown): SlackRouteEscalationConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new ApiError("routes[].escalation must be an object", 400);
  }
  const input = value as Record<string, unknown>;
  const emoji = input.emoji as Record<string, unknown> | undefined;
  const victorops = input.victorops as Record<string, unknown> | undefined;
  return {
    ...(emoji
      ? {
          emoji: {
            enabled: Boolean(emoji.enabled),
            ...(typeof emoji.name === "string" ? { name: emoji.name } : {}),
          },
        }
      : {}),
    ...(Array.isArray(input.delete_admins) ? { delete_admins: input.delete_admins.map(String) } : {}),
    ...(Array.isArray(input.users) ? { users: input.users.map(String) } : {}),
    ...(victorops
      ? {
          victorops: {
            enabled: Boolean(victorops.enabled),
            ...(typeof victorops.team === "string" ? { team: victorops.team } : {}),
          },
        }
      : {}),
  };
}

function parseRoute(
  value: unknown,
  index: number,
  workspaceId: string,
  channelId: string
): SlackChannelAgentRouteInput {
  if (!value || typeof value !== "object") {
    throw new ApiError(`routes[${index}] must be an object`, 400);
  }
  const input = value as Record<string, unknown>;
  const agentId = typeof input.agent_id === "string" ? input.agent_id.trim() : "";
  if (!agentId) {
    throw new ApiError(`routes[${index}].agent_id is required`, 400);
  }
  const priority =
    typeof input.priority === "number" && Number.isFinite(input.priority)
      ? input.priority
      : index;
  return {
    workspace_id: workspaceId,
    channel_id: channelId,
    agent_id: agentId,
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    priority,
    users: parseSideConfig(input.users, "users"),
    bots: parseSideConfig(input.bots, "bots"),
    escalation: parseEscalation(input.escalation),
    created_by: "api",
  };
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { workspaceId, channelId } = await context.params;
  return withSlackChannelRebacViewAuth(request, async () => {
    const [agentIds, metadataRoutes] = await Promise.all([
      listOpenFgaChannelAgentIds(workspaceId, channelId),
      listSlackChannelAgentRoutes(workspaceId, channelId),
    ]);
    const routes = mergeOpenFgaAgentsWithMetadata(workspaceId, channelId, agentIds, metadataRoutes);
    return successResponse({ routes });
  }, { workspaceId, channelId });
});

export const PUT = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { workspaceId, channelId } = await context.params;
  return withSlackChannelRebacManageAuth(request, async () => {
    const body = (await request.json()) as { routes?: unknown };
    if (!Array.isArray(body.routes)) {
      throw new ApiError("routes must be an array", 400);
    }

    const actor = "api";
    const routes = body.routes.map((route, index) =>
      parseRoute(route, index, workspaceId, channelId)
    );
    const existingAgentIds = await listOpenFgaChannelAgentIds(workspaceId, channelId);
    const enabledAgentIds = routes
      .filter((route) => route.enabled)
      .map((route) => route.agent_id);
    const uniqueEnabledAgentIds = Array.from(new Set(enabledAgentIds));

    const writes = uniqueEnabledAgentIds.map((agentId) =>
      slackChannelGrantRelationship(workspaceId, channelId, { type: "agent", id: agentId }, "use")
    );
    const deletes = existingAgentIds
      .filter((agentId) => !uniqueEnabledAgentIds.includes(agentId))
      .map((agentId) =>
        slackChannelGrantRelationship(workspaceId, channelId, { type: "agent", id: agentId }, "use")
      );
    const openfga = await writeRequiredOpenFgaTuples(writes, deletes);
    const saved = await replaceSlackChannelAgentRoutes(workspaceId, channelId, routes, actor);

    return successResponse({ routes: saved, openfga });
  }, { workspaceId, channelId });
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { workspaceId, channelId } = await context.params;
  return withSlackChannelRebacManageAuth(request, async () => {
    const body = (await request.json()) as { agent_id?: unknown };
    const agentId = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
    if (!agentId) {
      throw new ApiError("agent_id is required", 400);
    }

    const relationship = slackChannelGrantRelationship(
      workspaceId,
      channelId,
      { type: "agent", id: agentId },
      "use"
    );
    const openfga = await writeRequiredOpenFgaTuples([], [relationship]);
    const routeMetadataDeleted = await deleteSlackChannelAgentRoute(workspaceId, channelId, agentId);

    return successResponse({
      deleted: {
        agent_id: agentId,
        route_metadata_deleted: routeMetadataDeleted,
      },
      openfga,
    });
  }, { workspaceId, channelId });
});
