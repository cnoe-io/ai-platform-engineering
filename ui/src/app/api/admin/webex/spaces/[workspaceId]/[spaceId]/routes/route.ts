import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { ensureRouteOwnedAgentGrants } from "@/lib/rbac/webex-space-grant-store";
import {
  listOpenFgaWebexSpaceAgentIds,
  parseWebexSpaceRouteParams,
} from "@/lib/rbac/webex-space-openfga";
import {
  deleteWebexSpaceAgentRoute,
  listWebexSpaceAgentRoutes,
  replaceWebexSpaceAgentRoutes,
  type WebexSpaceAgentRouteInput,
} from "@/lib/rbac/webex-space-route-store";
import { webexSpaceGrantRelationship } from "@/lib/rbac/webex-space-rebac";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";
import type {
  WebexRouteEscalationConfig,
  WebexRouteSideConfig,
  WebexSpaceAgentRoute,
} from "@/types/webex-rebac";

import { withWebexSpaceRebacManageAuth, withWebexSpaceRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; spaceId: string }>;
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
  spaceId: string,
  agentId: string
): WebexSpaceAgentRoute {
  const now = new Date().toISOString();
  return {
    workspace_id: workspaceId,
    space_id: spaceId,
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
  spaceId: string,
  agentIds: string[],
  metadataRoutes: WebexSpaceAgentRoute[]
): WebexSpaceAgentRoute[] {
  const metadataByAgentId = new Map(metadataRoutes.map((route) => [route.agent_id, route]));
  return agentIds
    .map((agentId) => metadataByAgentId.get(agentId) ?? defaultRouteForAgent(workspaceId, spaceId, agentId))
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
    agent_id: route.agent_id,
    enabled: route.enabled,
    priority: route.priority,
    users: route.users,
    bots: route.bots,
    escalation: route.escalation,
    created_by: route.created_by,
  }));
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) =>
  withWebexSpaceRebacViewAuth(request, async () => {
    const raw = await context.params;
    const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
    const [agentIds, metadataRoutes] = await Promise.all([
      listOpenFgaWebexSpaceAgentIds(workspaceId, spaceId),
      listWebexSpaceAgentRoutes(workspaceId, spaceId),
    ]);
    const routes = mergeOpenFgaAgentsWithMetadata(workspaceId, spaceId, agentIds, metadataRoutes);
    return successResponse({ routes });
  })
);

export const PUT = withErrorHandler(async (request: NextRequest, context: RouteContext) =>
  withWebexSpaceRebacManageAuth(request, async () => {
    const raw = await context.params;
    const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
    const body = (await request.json()) as { routes?: unknown };
    if (!Array.isArray(body.routes)) {
      throw new ApiError("routes must be an array", 400);
    }

    const actor = "api";
    const routes = body.routes.map((route, index) => parseRoute(route, index, workspaceId, spaceId));
    const previousRoutes = toRouteInputs(await listWebexSpaceAgentRoutes(workspaceId, spaceId));
    const existingAgentIds = await listOpenFgaWebexSpaceAgentIds(workspaceId, spaceId);
    const enabledAgentIds = routes.filter((route) => route.enabled).map((route) => route.agent_id);
    const uniqueEnabledAgentIds = Array.from(new Set(enabledAgentIds));

    const writes = uniqueEnabledAgentIds.map((agentId) =>
      webexSpaceGrantRelationship(workspaceId, spaceId, { type: "agent", id: agentId }, "use")
    );
    const deletes = existingAgentIds
      .filter((agentId) => !uniqueEnabledAgentIds.includes(agentId))
      .map((agentId) =>
        webexSpaceGrantRelationship(workspaceId, spaceId, { type: "agent", id: agentId }, "use")
      );

    const saved = await replaceWebexSpaceAgentRoutes(workspaceId, spaceId, routes, actor);
    await ensureRouteOwnedAgentGrants(workspaceId, spaceId, uniqueEnabledAgentIds, actor);
    try {
      const openfga = await writeRequiredOpenFgaTuples(writes, deletes);
      return successResponse({ routes: saved, openfga });
    } catch (error) {
      await replaceWebexSpaceAgentRoutes(workspaceId, spaceId, previousRoutes, actor);
      await ensureRouteOwnedAgentGrants(
        workspaceId,
        spaceId,
        previousRoutes.filter((route) => route.enabled !== false).map((route) => route.agent_id),
        actor
      );
      throw new ApiError(
        error instanceof Error ? `OpenFGA tuple write failed: ${error.message}` : "OpenFGA tuple write failed",
        502
      );
    }
  })
);

export const DELETE = withErrorHandler(async (request: NextRequest, context: RouteContext) =>
  withWebexSpaceRebacManageAuth(request, async () => {
    const raw = await context.params;
    const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
    const body = (await request.json()) as { agent_id?: unknown };
    const agentId = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
    if (!agentId) {
      throw new ApiError("agent_id is required", 400);
    }

    const relationship = webexSpaceGrantRelationship(
      workspaceId,
      spaceId,
      { type: "agent", id: agentId },
      "use"
    );
    const previousRoutes = await listWebexSpaceAgentRoutes(workspaceId, spaceId);
    const restoreRoute = previousRoutes.find((route) => route.agent_id === agentId);
    const routeMetadataDeleted = await deleteWebexSpaceAgentRoute(workspaceId, spaceId, agentId);
    try {
      const openfga = await writeRequiredOpenFgaTuples([], [relationship]);
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
          [toRouteInputs([restoreRoute])[0]],
          "api"
        );
      }
      throw new ApiError(
        error instanceof Error ? `OpenFGA tuple write failed: ${error.message}` : "OpenFGA tuple write failed",
        502
      );
    }
  })
);
