import type { Document } from "mongodb";

import type {
WebexRouteEscalationConfig,
WebexRouteSideConfig,
WebexSpaceAgentRoute,
} from "@/types/webex-rebac";

import { getRbacCollection } from "./mongo-collections";
import { webexWorkspaceRef } from "./webex-space-grant-store";

export interface WebexSpaceAgentRouteDocument extends Document, WebexSpaceAgentRoute {}

export interface WebexSpaceAgentRouteInput {
  bot_id?: string;
  workspace_id: string;
  space_id: string;
  agent_id: string;
  enabled?: boolean;
  priority?: number;
  users?: WebexRouteSideConfig;
  bots?: WebexRouteSideConfig;
  escalation?: WebexRouteEscalationConfig;
  created_by?: string;
}

function routeId(botId: string, workspaceId: string, spaceId: string): string {
  return JSON.stringify([botId, webexWorkspaceRef(workspaceId), spaceId]);
}

function routeTimestamp(route: WebexSpaceAgentRouteDocument): string {
  return String(route.updated_at ?? route.created_at ?? "");
}

export async function listWebexSpaceAgentRoutes(
  workspaceId: string,
  spaceId: string,
  botId?: string,
): Promise<WebexSpaceAgentRouteDocument[]> {
  const collection = await getRbacCollection<WebexSpaceAgentRouteDocument>("webexSpaceAgentRoutes");
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const rows = await collection
    .find({
      workspace_id: workspaceRef,
      space_id: spaceId,
      ...(botId ? { bot_id: botId } : {}),
      status: "active",
    } as never)
    .sort({ bot_id: 1, updated_at: -1, created_at: -1 })
    .toArray();

  // Older writers included agent_id in the upsert key and could leave more
  // than one row for a bot/space. Read the newest row only while a subsequent
  // save converges storage to the canonical one-row key.
  const newestByBot = new Map<string, WebexSpaceAgentRouteDocument>();
  for (const row of rows as WebexSpaceAgentRouteDocument[]) {
    const current = newestByBot.get(row.bot_id);
    if (!current || routeTimestamp(row) > routeTimestamp(current)) {
      newestByBot.set(row.bot_id, row);
    }
  }
  return Array.from(newestByBot.values());
}

export async function replaceWebexSpaceAgentRoutes(
  workspaceId: string,
  spaceId: string,
  botId: string,
  routes: WebexSpaceAgentRouteInput[],
  actor: string
): Promise<WebexSpaceAgentRouteDocument[]> {
  const collection = await getRbacCollection<WebexSpaceAgentRouteDocument>("webexSpaceAgentRoutes");
  const now = new Date().toISOString();
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const activeRoutes = routes.filter((route) => route.agent_id.trim());
  if (activeRoutes.length > 1) {
    throw new Error("A Webex bot can have only one agent route per space");
  }

  const key = { bot_id: botId, workspace_id: workspaceRef, space_id: spaceId };
  if (activeRoutes.length === 0) {
    await collection.deleteMany(key as never);
    return [];
  }

  const route = activeRoutes[0];
  const agentId = route.agent_id.trim();
  const id = routeId(botId, workspaceRef, spaceId);
  const unset: Record<string, ""> = {};
  if (!route.users) unset.users = "";
  if (!route.bots) unset.bots = "";
  if (!route.escalation) unset.escalation = "";
  await collection.updateOne(
    { _id: id } as never,
    ({
      $set: {
        ...key,
        agent_id: agentId,
        enabled: route.enabled ?? true,
        priority: route.priority ?? 100,
        ...(route.users ? { users: route.users } : {}),
        ...(route.bots ? { bots: route.bots } : {}),
        ...(route.escalation ? { escalation: route.escalation } : {}),
        source_type: "manual",
        status: "active",
        updated_by: actor,
        updated_at: now,
      },
      $setOnInsert: {
        created_by: route.created_by ?? actor,
        created_at: now,
      },
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    } as never),
    { upsert: true }
  );
  await collection.deleteMany({ ...key, _id: { $ne: id } } as never);

  return listWebexSpaceAgentRoutes(workspaceRef, spaceId, botId);
}

export async function deleteWebexSpaceAgentRoute(
  workspaceId: string,
  spaceId: string,
  botId: string,
  agentId: string
): Promise<boolean> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) return false;

  const collection = await getRbacCollection<WebexSpaceAgentRouteDocument>("webexSpaceAgentRoutes");
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const result = await collection.deleteMany({
    workspace_id: workspaceRef,
    space_id: spaceId,
    bot_id: botId,
    agent_id: normalizedAgentId,
  } as never);
  return (result.deletedCount ?? 0) > 0;
}

// assisted-by Codex Codex-sonnet-4-6
export async function deleteWebexSpaceAgentRoutes(
  workspaceId: string,
  spaceId: string,
  botId?: string,
): Promise<number> {
  const collection = await getRbacCollection<WebexSpaceAgentRouteDocument>("webexSpaceAgentRoutes");
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const result = await collection.deleteMany({
    workspace_id: workspaceRef,
    space_id: spaceId,
    ...(botId ? { bot_id: botId } : {}),
  } as never);
  return result.deletedCount ?? 0;
}
