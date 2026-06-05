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

export async function listWebexSpaceAgentRoutes(
  workspaceId: string,
  spaceId: string
): Promise<WebexSpaceAgentRouteDocument[]> {
  const collection = await getRbacCollection<WebexSpaceAgentRouteDocument>("webexSpaceAgentRoutes");
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const rows = await collection
    .find({
      workspace_id: workspaceRef,
      space_id: spaceId,
      status: "active",
    } as never)
    .sort({ priority: 1, agent_id: 1 })
    .toArray();
  return rows as WebexSpaceAgentRouteDocument[];
}

export async function replaceWebexSpaceAgentRoutes(
  workspaceId: string,
  spaceId: string,
  routes: WebexSpaceAgentRouteInput[],
  actor: string
): Promise<WebexSpaceAgentRouteDocument[]> {
  const collection = await getRbacCollection<WebexSpaceAgentRouteDocument>("webexSpaceAgentRoutes");
  const now = new Date().toISOString();
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const activeAgentIds: string[] = [];

  for (const route of routes) {
    const agentId = route.agent_id.trim();
    if (!agentId) continue;
    activeAgentIds.push(agentId);
  }

  const uniqueActiveAgentIds = Array.from(new Set(activeAgentIds));

  await collection.updateMany(
    {
      workspace_id: workspaceRef,
      space_id: spaceId,
      status: "active",
      agent_id: { $nin: uniqueActiveAgentIds },
    } as never,
    { $set: { status: "revoked", updated_by: actor, updated_at: now } }
  );

  for (const route of routes) {
    const agentId = route.agent_id.trim();
    if (!agentId) continue;

    const unset: Record<string, ""> = {};
    if (!route.users) unset.users = "";
    if (!route.bots) unset.bots = "";
    if (!route.escalation) unset.escalation = "";
    await collection.updateOne(
      {
        workspace_id: workspaceRef,
        space_id: spaceId,
        agent_id: agentId,
      } as never,
      ({
        $set: {
          workspace_id: workspaceRef,
          space_id: spaceId,
          agent_id: agentId,
          enabled: route.enabled ?? true,
          priority: route.priority ?? 100,
          ...(route.users ? { users: route.users } : {}),
          ...(route.bots ? { bots: route.bots } : {}),
          ...(route.escalation ? { escalation: route.escalation } : {}),
          source_type: "manual",
          status: "active",
          created_by: route.created_by ?? actor,
          created_at: now,
          updated_by: actor,
          updated_at: now,
        },
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      } as never),
      { upsert: true }
    );
  }

  return listWebexSpaceAgentRoutes(workspaceRef, spaceId);
}

export async function deleteWebexSpaceAgentRoute(
  workspaceId: string,
  spaceId: string,
  agentId: string
): Promise<boolean> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) return false;

  const collection = await getRbacCollection<WebexSpaceAgentRouteDocument>("webexSpaceAgentRoutes");
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const result = await collection.deleteOne({
    workspace_id: workspaceRef,
    space_id: spaceId,
    agent_id: normalizedAgentId,
  } as never);
  return result.deletedCount > 0;
}
