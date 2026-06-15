import { NextRequest } from "next/server";

import { ApiError,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { readOpenFgaTuples,writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { slackChannelSubjectId,slackWorkspaceRef } from "@/lib/rbac/slack-channel-grant-store";
import { slackChannelGrantRelationship } from "@/lib/rbac/slack-channel-rebac";
import {
deleteSlackChannelAgentRoute,
listSlackChannelAgentRoutes,
replaceSlackChannelAgentRoutes,
type SlackChannelAgentRouteInput,
} from "@/lib/rbac/slack-channel-route-store";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import { getBySub } from "@/lib/service-accounts";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";
import type {
SlackChannelAgentRoute,
SlackRouteEscalationConfig,
SlackRouteExecutionIdentity,
SlackRouteSideConfig,
} from "@/types/slack-rebac";

import { withSlackChannelRebacManageAuth,withSlackChannelRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

interface ChannelTeamMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id: string;
  team_slug?: string;
  active?: boolean;
}

/**
 * SEC-1: Look up the team that owns a given Slack channel via the
 * channel_team_mappings collection. Returns the team slug or null when
 * no active mapping exists.
 */
async function getChannelOwningTeamSlug(workspaceId: string, channelId: string): Promise<string | null> {
  const mappings = await getCollection<ChannelTeamMappingDoc>("channel_team_mappings");
  const mapping = await mappings.findOne({
    slack_workspace_id: slackWorkspaceRef(workspaceId),
    slack_channel_id: channelId,
    active: { $ne: false },
  } as never);
  return mapping?.team_slug ?? null;
}

/**
 * SEC-1: Verify that the service account identified by `saSub` belongs to the
 * channel's owning team. Throws ApiError(403) when:
 *  - The SA doc does not exist or is revoked.
 *  - The SA's owning_team_id does not match the channel's team.
 *
 * Returns silently when valid.
 */
async function verifyServiceAccountOwnership(
  saSub: string,
  channelOwningTeamSlug: string | null,
  routeIndex: number,
): Promise<void> {
  const saDoc = await getBySub(saSub);
  if (!saDoc || saDoc.status !== "active") {
    throw new ApiError(
      `routes[${routeIndex}].execution_identity.service_account_sub: service account not found or is revoked`,
      403
    );
  }
  if (channelOwningTeamSlug !== null && saDoc.owning_team_id !== channelOwningTeamSlug) {
    throw new ApiError(
      `routes[${routeIndex}].execution_identity.service_account_sub: service account does not belong to this channel's team`,
      403
    );
  }
}

function agentIdFromObject(object: string): string | null {
  if (!object.startsWith("agent:")) return null;
  const agentId = object.slice("agent:".length).trim();
  return agentId || null;
}

async function listOpenFgaChannelAgentIds(workspaceId: string, channelId: string): Promise<string[]> {
  // SEC-6: pass a server-side tuple filter scoped to this channel's subject so
  // OpenFGA only returns tuples where the channel is the "user" (i.e. the channel
  // has been granted access to use an agent). Without the filter the read fetched
  // all tuples in the store and relied on in-memory filtering — both a performance
  // hazard and an over-read of unrelated data.
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
    // Materialised from an existing OpenFGA channel→agent tuple that has no
    // Mongo route metadata yet. The tuple is the opt-in signal, so default
    // to listening on both @mentions and plain channel messages; admins can
    // narrow via the Step-2a route picker.
    // assisted-by Cursor claude-opus-4-7
    users: { enabled: true, listen: "all" },
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
  if (typeof input.listen === "string" && !["message", "mention", "all"].includes(input.listen)) {
    throw new ApiError(`routes[].${field}.listen must be one of: message, mention, all`, 400);
  }
  return {
    ...(input.enabled !== undefined ? { enabled: Boolean(input.enabled) } : {}),
    ...(typeof input.listen === "string" ? { listen: input.listen as SlackRouteSideConfig["listen"] } : {}),
    ...(Array.isArray(input.user_list) ? { user_list: input.user_list.map(String) } : {}),
    ...(Array.isArray(input.bot_list) ? { bot_list: input.bot_list.map(String) } : {}),
    ...(input.overthink && typeof input.overthink === "object"
      ? { overthink: parseOverthink(input.overthink as Record<string, unknown>) }
      : {}),
  };
}

function parseOverthink(input: Record<string, unknown>): NonNullable<SlackRouteSideConfig["overthink"]> {
  return {
    enabled: Boolean(input.enabled),
    ...(Array.isArray(input.skip_markers) ? { skip_markers: input.skip_markers.map(String) } : {}),
    ...(typeof input.followup_prompt === "string" ? { followup_prompt: input.followup_prompt } : {}),
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
  if (victorops && Boolean(victorops.enabled) && !(typeof victorops.team === "string" && victorops.team.trim())) {
    throw new ApiError("routes[].escalation.victorops.team is required when VictorOps is enabled", 400);
  }
  if (emoji && Boolean(emoji.enabled) && !(typeof emoji.name === "string" && emoji.name.trim())) {
    throw new ApiError("routes[].escalation.emoji.name is required when emoji escalation is enabled", 400);
  }
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

/**
 * Validate and parse the optional execution_identity field on a route input.
 *
 * Rules:
 *  - Omitted → undefined (caller defaults to obo_user in the store).
 *  - mode "service_account" requires service_account_sub (400 otherwise).
 *  - mode "obo_user" must NOT include service_account_sub (ignored if provided
 *    but we strip it so it doesn't leak noise into Mongo).
 */
function parseExecutionIdentity(
  value: unknown,
  index: number
): SlackRouteExecutionIdentity | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") {
    throw new ApiError(`routes[${index}].execution_identity must be an object`, 400);
  }
  const input = value as Record<string, unknown>;
  const mode = input.mode;
  if (mode !== "obo_user" && mode !== "service_account") {
    throw new ApiError(
      `routes[${index}].execution_identity.mode must be "obo_user" or "service_account"`,
      400
    );
  }
  if (mode === "service_account") {
    const sub = typeof input.service_account_sub === "string" ? input.service_account_sub.trim() : "";
    if (!sub) {
      throw new ApiError(
        `routes[${index}].execution_identity.service_account_sub is required when mode is "service_account"`,
        400
      );
    }
    return {
      mode: "service_account",
      service_account_sub: sub,
      ...(typeof input.service_account_name === "string" && input.service_account_name.trim()
        ? { service_account_name: input.service_account_name.trim() }
        : {}),
    };
  }
  // mode === "obo_user" — strip SA fields
  return { mode: "obo_user" };
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
  const users = parseSideConfig(input.users, "users");
  const bots = parseSideConfig(input.bots, "bots");
  if (users?.enabled === false && bots?.enabled === false) {
    throw new ApiError(`routes[${index}] must enable users, bots, or both`, 400);
  }
  const execution_identity = parseExecutionIdentity(input.execution_identity, index);
  return {
    workspace_id: workspaceId,
    channel_id: channelId,
    agent_id: agentId,
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    priority,
    users,
    bots,
    escalation: parseEscalation(input.escalation),
    ...(execution_identity !== undefined ? { execution_identity } : {}),
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

    // SEC-1: for any route with execution_identity.mode === "service_account",
    // verify the SA belongs to this channel's owning team. We resolve the team
    // once (lazy — only when at least one SA route is present) and validate each.
    const saRoutes = routes
      .map((route, index) => ({ route, index }))
      .filter(({ route }) => route.execution_identity?.mode === "service_account");

    if (saRoutes.length > 0) {
      const channelOwningTeamSlug = await getChannelOwningTeamSlug(workspaceId, channelId);
      await Promise.all(
        saRoutes.map(({ route, index }) =>
          verifyServiceAccountOwnership(
            route.execution_identity!.service_account_sub!,
            channelOwningTeamSlug,
            index,
          )
        )
      );
    }

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
