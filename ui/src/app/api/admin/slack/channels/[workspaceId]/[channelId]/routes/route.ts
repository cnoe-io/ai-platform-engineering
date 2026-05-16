import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { ensureRouteOwnedAgentGrants } from "@/lib/rbac/slack-channel-grant-store";
import {
  listSlackChannelAgentRoutes,
  replaceSlackChannelAgentRoutes,
  type SlackChannelAgentRouteInput,
} from "@/lib/rbac/slack-channel-route-store";
import { slackChannelGrantRelationship } from "@/lib/rbac/slack-channel-rebac";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import type { SlackRouteEscalationConfig, SlackRouteSideConfig } from "@/types/slack-rebac";

import { withSlackChannelRebacManageAuth, withSlackChannelRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
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

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) =>
  withSlackChannelRebacViewAuth(request, async () => {
    const { workspaceId, channelId } = await context.params;
    const routes = await listSlackChannelAgentRoutes(workspaceId, channelId);
    return successResponse({ routes });
  })
);

export const PUT = withErrorHandler(async (request: NextRequest, context: RouteContext) =>
  withSlackChannelRebacManageAuth(request, async () => {
    const { workspaceId, channelId } = await context.params;
    const body = (await request.json()) as { routes?: unknown };
    if (!Array.isArray(body.routes)) {
      throw new ApiError("routes must be an array", 400);
    }

    const actor = "api";
    const routes = body.routes.map((route, index) =>
      parseRoute(route, index, workspaceId, channelId)
    );
    const saved = await replaceSlackChannelAgentRoutes(workspaceId, channelId, routes, actor);
    const enabledAgentIds = saved
      .filter((route) => route.enabled)
      .map((route) => route.agent_id);

    await ensureRouteOwnedAgentGrants(workspaceId, channelId, enabledAgentIds, actor);
    const writes = enabledAgentIds.map((agentId) =>
      slackChannelGrantRelationship(workspaceId, channelId, { type: "agent", id: agentId }, "use")
    );
    const openfga = await writeOpenFgaTuples(buildUniversalRebacTupleDiff({ writes, deletes: [] }))
      .catch((error) => ({
        enabled: false,
        writes: 0,
        deletes: 0,
        error: error instanceof Error ? error.message : "OpenFGA tuple write failed",
      }));

    return successResponse({ routes: saved, openfga });
  })
);
