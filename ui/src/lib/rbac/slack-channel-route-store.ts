import type { Document } from "mongodb";

import type {
SlackChannelAgentRoute,
SlackRouteEscalationConfig,
SlackRouteExecutionIdentity,
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
  /**
   * Per-route execution identity. Omitted/undefined === { mode: "obo_user" }.
   * Backward-compatible: existing docs without this field default to obo_user at read time.
   */
  execution_identity?: SlackRouteExecutionIdentity;
  created_by?: string;
}

/**
 * Default execution_identity for existing docs that predate this field.
 * Backward-compatible: omitted field === { mode: "obo_user" }.
 */
function normalizeExecutionIdentity(doc: SlackChannelAgentRouteDocument): SlackChannelAgentRouteDocument {
  if (!doc.execution_identity) {
    return { ...doc, execution_identity: { mode: "obo_user" } };
  }
  return doc;
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
  return (rows as SlackChannelAgentRouteDocument[]).map(normalizeExecutionIdentity);
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
    // execution_identity: always write it (normalize to obo_user default if absent)
    const executionIdentity: SlackRouteExecutionIdentity =
      route.execution_identity ?? { mode: "obo_user" };
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
          execution_identity: executionIdentity,
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

// Hard-delete every route document for a channel, regardless of status. Used
// when offboarding a channel entirely; the per-agent revoke/upsert reconcile
// in replaceSlackChannelAgentRoutes does not apply here because the channel
// itself is going away.
export async function deleteSlackChannelAgentRoutes(
  workspaceId: string,
  channelId: string
): Promise<number> {
  const collection = await getRbacCollection<SlackChannelAgentRouteDocument>("slackChannelAgentRoutes");
  const workspaceRef = slackWorkspaceRef(workspaceId);
  const result = await collection.deleteMany({
    workspace_id: workspaceRef,
    channel_id: channelId,
  } as never);
  return result.deletedCount ?? 0;
}
