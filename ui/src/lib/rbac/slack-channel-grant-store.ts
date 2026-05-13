import type { Document } from "mongodb";

import type {
  SlackChannelGrantResourceType,
  SlackChannelResourceGrant,
} from "@/types/slack-rebac";
import type { UniversalRebacResourceAction, UniversalRebacResourceRef } from "@/types/rbac-universal";

import { getRbacCollection } from "./mongo-collections";

export interface SlackChannelGrantDocument extends Document, SlackChannelResourceGrant {}

export interface SlackChannelGrantInput {
  workspace_id: string;
  channel_id: string;
  resource: UniversalRebacResourceRef & { type: SlackChannelGrantResourceType };
  actions: UniversalRebacResourceAction[];
  created_by?: string;
}

export const SLACK_CHANNEL_GRANT_RESOURCE_TYPES = new Set<SlackChannelGrantResourceType>([
  "agent",
  "tool",
  "knowledge_base",
  "skill",
  "task",
]);

export function slackChannelSubjectId(workspaceId: string, channelId: string): string {
  return `${workspaceId}--${channelId}`;
}

export async function listSlackChannelGrants(
  workspaceId: string,
  channelId: string
): Promise<SlackChannelGrantDocument[]> {
  const collection = await getRbacCollection<SlackChannelGrantDocument>("slackChannelGrants");
  const rows = await collection
    .find({
      workspace_id: workspaceId,
      channel_id: channelId,
      status: "active",
    } as never)
    .sort({ "resource.type": 1, "resource.id": 1 })
    .toArray();
  return rows as SlackChannelGrantDocument[];
}

export async function replaceSlackChannelGrants(
  workspaceId: string,
  channelId: string,
  grants: SlackChannelGrantInput[],
  actor: string
): Promise<SlackChannelGrantDocument[]> {
  const collection = await getRbacCollection<SlackChannelGrantDocument>("slackChannelGrants");
  const now = new Date().toISOString();

  await collection.updateMany(
    { workspace_id: workspaceId, channel_id: channelId, status: "active" } as never,
    { $set: { status: "revoked", updated_by: actor, updated_at: now } }
  );

  for (const grant of grants) {
    await collection.updateOne(
      {
        workspace_id: workspaceId,
        channel_id: channelId,
        "resource.type": grant.resource.type,
        "resource.id": grant.resource.id,
      } as never,
      {
        $set: {
          workspace_id: workspaceId,
          channel_id: channelId,
          resource: grant.resource,
          actions: grant.actions,
          source_type: "manual",
          status: "active",
          created_by: grant.created_by ?? actor,
          created_at: now,
          updated_by: actor,
          updated_at: now,
        },
      },
      { upsert: true }
    );
  }

  return listSlackChannelGrants(workspaceId, channelId);
}
