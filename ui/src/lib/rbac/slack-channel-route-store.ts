import type { Document } from "mongodb";

import type {
  SlackChannelAgentRoute,
  SlackRouteEscalationConfig,
  SlackRouteSideConfig,
} from "@/types/slack-rebac";

import { getRbacCollection } from "./mongo-collections";
import { slackWorkspaceRef } from "./slack-channel-grant-store";

export interface SlackChannelAgentRouteDocument extends Document, SlackChannelAgentRoute {}

export interface SlackChannelAgentRouteInput {
  workspace_id: string;
  channel_id: string;
  agent_id: string;
  enabled?: boolean;
  priority?: number;
  users?: SlackRouteSideConfig;
  bots?: SlackRouteSideConfig;
  escalation?: SlackRouteEscalationConfig;
  created_by?: string;
}

export async function listSlackChannelAgentRoutes(
  workspaceId: string,
  channelId: string
): Promise<SlackChannelAgentRouteDocument[]> {
  const collection = await getRbacCollection<SlackChannelAgentRouteDocument>("slackChannelAgentRoutes");
  const workspaceRef = slackWorkspaceRef(workspaceId);
  const rows = await collection
    .find({
      workspace_id: workspaceRef,
      channel_id: channelId,
      status: "active",
    } as never)
    .sort({ priority: 1, agent_id: 1 })
    .toArray();
  return rows as SlackChannelAgentRouteDocument[];
}

export async function replaceSlackChannelAgentRoutes(
  workspaceId: string,
  channelId: string,
  routes: SlackChannelAgentRouteInput[],
  actor: string
): Promise<SlackChannelAgentRouteDocument[]> {
  const collection = await getRbacCollection<SlackChannelAgentRouteDocument>("slackChannelAgentRoutes");
  const now = new Date().toISOString();
  const workspaceRef = slackWorkspaceRef(workspaceId);
  const activeAgentIds = Array.from(
    new Set(routes.map((route) => route.agent_id.trim()).filter(Boolean))
  );

  await collection.updateMany(
    {
      workspace_id: workspaceRef,
      channel_id: channelId,
      status: "active",
      agent_id: { $nin: activeAgentIds },
    } as never,
    { $set: { status: "revoked", updated_by: actor, updated_at: now } }
  );

  for (const route of routes) {
    const unset: Record<string, ""> = {};
    if (!route.users) unset.users = "";
    if (!route.bots) unset.bots = "";
    if (!route.escalation) unset.escalation = "";
    await collection.updateOne(
      {
        workspace_id: workspaceRef,
        channel_id: channelId,
        agent_id: route.agent_id,
      } as never,
      ({
        $set: {
          workspace_id: workspaceRef,
          channel_id: channelId,
          agent_id: route.agent_id,
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

  return listSlackChannelAgentRoutes(workspaceRef, channelId);
}

export async function deleteSlackChannelAgentRoute(
  workspaceId: string,
  channelId: string,
  agentId: string
): Promise<boolean> {
  const collection = await getRbacCollection<SlackChannelAgentRouteDocument>("slackChannelAgentRoutes");
  const workspaceRef = slackWorkspaceRef(workspaceId);
  const result = await collection.deleteOne({
    workspace_id: workspaceRef,
    channel_id: channelId,
    agent_id: agentId,
  } as never);
  return result.deletedCount > 0;
}
