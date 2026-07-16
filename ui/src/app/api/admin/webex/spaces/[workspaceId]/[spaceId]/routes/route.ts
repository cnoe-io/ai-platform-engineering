import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { type OpenFgaTupleKey, writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { ensureRouteOwnedAgentGrants } from "@/lib/rbac/webex-space-grant-store";
import {
  listOpenFgaWebexBotAgentIds,
  parseWebexSpaceRouteParams,
} from "@/lib/rbac/webex-space-openfga";
import {
  webexBotInstallationAgentTuple,
  webexBotInstallationIdentityTuples,
} from "@/lib/rbac/webex-bot-openfga";
import {
deleteWebexSpaceAgentRoute,
listWebexSpaceAgentRoutes,
replaceWebexSpaceAgentRoutes,
type WebexSpaceAgentRouteInput,
} from "@/lib/rbac/webex-space-route-store";
import type {
WebexRouteEscalationConfig,
WebexRouteSideConfig,
WebexSpaceAgentRoute,
} from "@/types/webex-rebac";
import { requireAvailableWebexBotId } from "@/lib/webex-bot-catalog";

import { withWebexSpaceRebacManageAuth, withWebexSpaceRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

async function writeRequiredOpenFgaTuples(
  writes: OpenFgaTupleKey[],
  deletes: OpenFgaTupleKey[],
) {
  try {
    const result = await writeOpenFgaTuples({ writes, deletes });
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

function mergeOpenFgaAgentsWithMetadata(
  agentIds: string[],
  metadataRoutes: WebexSpaceAgentRoute[]
): WebexSpaceAgentRoute[] {
  const allowedAgentIds = new Set(agentIds);
  return metadataRoutes
    .filter((route) => allowedAgentIds.has(route.agent_id))
    .sort((left, right) => left.priority - right.priority || left.agent_id.localeCompare(right.agent_id));
}

function parseSideConfig(value: unknown, field: string): WebexRouteSideConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new ApiError(`routes[].${field} must be an object`, 400);
  }
  const input = value as Record<string, unknown>;
  return {
    ...(input.enabled !== undefined ? { enabled: Boolean(input.enabled) } : {}),
    ...(typeof input.listen === "string" ? { listen: input.listen as WebexRouteSideConfig["listen"] } : {}),
    ...(Array.isArray(input.user_list) ? { user_list: input.user_list.map(String) } : {}),
    ...(Array.isArray(input.bot_list) ? { bot_list: input.bot_list.map(String) } : {}),
    ...(input.overthink && typeof input.overthink === "object"
      ? { overthink: { enabled: Boolean((input.overthink as Record<string, unknown>).enabled) } }
      : {}),
  };
}

function parseEscalation(value: unknown): WebexRouteEscalationConfig | undefined {
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
  spaceId: string
): WebexSpaceAgentRouteInput {
  if (!value || typeof value !== "object") {
    throw new ApiError(`routes[${index}] must be an object`, 400);
  }
  const input = value as Record<string, unknown>;
  const agentId = typeof input.agent_id === "string" ? input.agent_id.trim() : "";
  if (!agentId) {
    throw new ApiError(`routes[${index}].agent_id is required`, 400);
  }
  const priority =
    typeof input.priority === "number" && Number.isFinite(input.priority) ? input.priority : index;
  return {
    workspace_id: workspaceId,
    space_id: spaceId,
    agent_id: agentId,
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    priority,
    users: parseSideConfig(input.users, "users"),
    bots: parseSideConfig(input.bots, "bots"),
    escalation: parseEscalation(input.escalation),
    created_by: "api",
  };
}

function toRouteInputs(routes: WebexSpaceAgentRoute[]): WebexSpaceAgentRouteInput[] {
  return routes.map((route) => ({
    workspace_id: route.workspace_id,
    space_id: route.space_id,
    bot_id: route.bot_id,
    agent_id: route.agent_id,
    enabled: route.enabled,
    priority: route.priority,
    users: route.users,
    bots: route.bots,
    escalation: route.escalation,
    created_by: route.created_by,
  }));
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
  return withWebexSpaceRebacViewAuth(request, async () => {
    const botId = requireAvailableWebexBotId(request.nextUrl.searchParams.get("bot_id"));
    const [agentIds, metadataRoutes] = await Promise.all([
      listOpenFgaWebexBotAgentIds(botId, workspaceId, spaceId),
      listWebexSpaceAgentRoutes(workspaceId, spaceId, botId),
    ]);
    const routes = mergeOpenFgaAgentsWithMetadata(agentIds, metadataRoutes);
    return successResponse({ routes });
  }, { workspaceId, spaceId });
});

export const PUT = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
  return withWebexSpaceRebacManageAuth(request, async () => {
    const botId = requireAvailableWebexBotId(request.nextUrl.searchParams.get("bot_id"));
    const body = (await request.json()) as { routes?: unknown };
    if (!Array.isArray(body.routes)) {
      throw new ApiError("routes must be an array", 400);
    }

    const actor = "api";
    const routes = body.routes.map((route, index) => parseRoute(route, index, workspaceId, spaceId));
    const previousRoutes = toRouteInputs(await listWebexSpaceAgentRoutes(workspaceId, spaceId, botId));
    const existingAgentIds = await listOpenFgaWebexBotAgentIds(botId, workspaceId, spaceId);
    const saved = await replaceWebexSpaceAgentRoutes(workspaceId, spaceId, botId, routes, actor);
    const allRoutes = await listWebexSpaceAgentRoutes(workspaceId, spaceId);
    const botRoutes = await listWebexSpaceAgentRoutes(workspaceId, spaceId, botId);
    const activeAgentIds = Array.from(new Set(
      botRoutes.filter((route) => route.enabled !== false).map((route) => route.agent_id),
    ));
    const writes = [
      ...webexBotInstallationIdentityTuples(botId, workspaceId, spaceId),
      ...activeAgentIds
      .filter((agentId) => !existingAgentIds.includes(agentId))
      .map((agentId) =>
        webexBotInstallationAgentTuple(botId, workspaceId, spaceId, agentId),
      ),
    ];
    const deletes = existingAgentIds
      .filter((agentId) => !activeAgentIds.includes(agentId))
      .map((agentId) =>
        webexBotInstallationAgentTuple(botId, workspaceId, spaceId, agentId),
      );

    await ensureRouteOwnedAgentGrants(
      workspaceId,
      spaceId,
      Array.from(new Set(
        allRoutes.filter((route) => route.enabled !== false).map((route) => route.agent_id),
      )),
      actor,
    );
    try {
      const openfga = await writeRequiredOpenFgaTuples(writes, deletes);
      return successResponse({ routes: saved, openfga });
    } catch (error) {
      await replaceWebexSpaceAgentRoutes(workspaceId, spaceId, botId, previousRoutes, actor);
      const restoredRoutes = await listWebexSpaceAgentRoutes(workspaceId, spaceId);
      await ensureRouteOwnedAgentGrants(
        workspaceId,
        spaceId,
        Array.from(new Set(
          restoredRoutes.filter((route) => route.enabled !== false).map((route) => route.agent_id),
        )),
        actor
      );
      throw new ApiError(
        error instanceof Error ? `OpenFGA tuple write failed: ${error.message}` : "OpenFGA tuple write failed",
        502
      );
    }
  }, { workspaceId, spaceId });
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
  return withWebexSpaceRebacManageAuth(request, async () => {
    const botId = requireAvailableWebexBotId(request.nextUrl.searchParams.get("bot_id"));
    const body = (await request.json()) as { agent_id?: unknown };
    const agentId = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
    if (!agentId) {
      throw new ApiError("agent_id is required", 400);
    }

    const previousRoutes = await listWebexSpaceAgentRoutes(workspaceId, spaceId, botId);
    const restoreRoute = previousRoutes.find((route) => route.agent_id === agentId);
    const routeMetadataDeleted = await deleteWebexSpaceAgentRoute(workspaceId, spaceId, botId, agentId);
    try {
      const remainingRoutes = await listWebexSpaceAgentRoutes(workspaceId, spaceId);
      const activeAgentIdsAcrossBots = Array.from(new Set(
        remainingRoutes.filter((route) => route.enabled !== false).map((route) => route.agent_id),
      ));
      await ensureRouteOwnedAgentGrants(workspaceId, spaceId, activeAgentIdsAcrossBots, "api");
      const openfga = await writeRequiredOpenFgaTuples(
        [],
        [webexBotInstallationAgentTuple(botId, workspaceId, spaceId, agentId)],
      );
      return successResponse({
        deleted: {
          agent_id: agentId,
          route_metadata_deleted: routeMetadataDeleted,
        },
        openfga,
      });
    } catch (error) {
      if (restoreRoute) {
        await replaceWebexSpaceAgentRoutes(
          workspaceId,
          spaceId,
          botId,
          [toRouteInputs([restoreRoute])[0]],
          "api"
        );
        const restoredRoutes = await listWebexSpaceAgentRoutes(workspaceId, spaceId);
        await ensureRouteOwnedAgentGrants(
          workspaceId,
          spaceId,
          Array.from(new Set(
            restoredRoutes.filter((route) => route.enabled !== false).map((route) => route.agent_id),
          )),
          "api",
        );
      }
      throw new ApiError(
        error instanceof Error ? `OpenFGA tuple write failed: ${error.message}` : "OpenFGA tuple write failed",
        502
      );
    }
  }, { workspaceId, spaceId });
});
