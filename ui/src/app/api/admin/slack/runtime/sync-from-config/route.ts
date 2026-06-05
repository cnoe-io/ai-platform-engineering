import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { slackWorkspaceRef } from "@/lib/rbac/slack-channel-grant-store";
import { callSlackBotAdmin } from "@/lib/slack-bot-admin";

interface ChannelTeamMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id: string;
  channel_name?: string;
  team_slug?: string;
  active?: boolean;
}

interface SyncPreviewChannel {
  workspace_id?: string;
  channel_id?: string;
  channel_name?: string;
  agents?: unknown[];
  [key: string]: unknown;
}

interface SyncFromConfigResult {
  channels?: SyncPreviewChannel[];
  [key: string]: unknown;
}

/**
 * The Slack bot's YAML config has no concept of teams, but Slack runtime
 * authz requires BOTH a channel→agent grant AND a team→agent grant. So a
 * channel imported purely from YAML is not invokable until it is assigned a
 * team via the Onboard tab. We annotate each preview channel with the team it
 * is currently mapped to (if any) so the admin can see, before importing,
 * which channels will still need a team assignment to actually work.
 */
async function annotateChannelsWithTeam(
  channels: SyncPreviewChannel[],
): Promise<SyncPreviewChannel[]> {
  if (channels.length === 0) return channels;
  const mappings = await getCollection<ChannelTeamMappingDoc>("channel_team_mappings");
  const rows = await mappings.find({ active: { $ne: false } } as never).toArray();
  const teamByChannel = new Map<string, string>();
  for (const row of rows) {
    if (!row.team_slug) continue;
    const key = `${slackWorkspaceRef(row.slack_workspace_id)}/${row.slack_channel_id}`;
    teamByChannel.set(key, row.team_slug);
  }
  return channels.map((channel) => {
    const workspaceRef = slackWorkspaceRef(channel.workspace_id ? String(channel.workspace_id) : undefined);
    const teamSlug = channel.channel_id
      ? teamByChannel.get(`${workspaceRef}/${channel.channel_id}`) ?? null
      : null;
    return { ...channel, team_slug: teamSlug, has_team: Boolean(teamSlug) };
  });
}

async function ensureImportedChannelRows(channels: SyncPreviewChannel[]): Promise<void> {
  if (channels.length === 0) return;
  const mappings = await getCollection<ChannelTeamMappingDoc & {
    source_type?: string;
    created_at?: string;
    updated_at?: string;
  }>("channel_team_mappings");
  const now = new Date().toISOString();
  for (const channel of channels) {
    if (!channel.channel_id) continue;
    const workspaceRef = slackWorkspaceRef(channel.workspace_id ? String(channel.workspace_id) : undefined);
    await mappings.updateOne(
      {
        slack_workspace_id: workspaceRef,
        slack_channel_id: String(channel.channel_id),
        active: { $ne: false },
      } as never,
      {
        $set: {
          channel_name: channel.channel_name ? String(channel.channel_name) : String(channel.channel_id),
          updated_at: now,
        },
        $setOnInsert: {
          slack_workspace_id: workspaceRef,
          slack_channel_id: String(channel.channel_id),
          active: true,
          source_type: "config_sync",
          created_at: now,
        },
      } as never,
      { upsert: true },
    );
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await callSlackBotAdmin<SyncFromConfigResult>("/admin/slack/routes/sync-from-config", {
    method: "POST",
    body: {
      dry_run: body.dry_run !== false,
      actor: {
        email: user.email,
        name: user.name,
        sub: typeof session.sub === "string" ? session.sub : undefined,
      },
    },
  });
  if (Array.isArray(result.channels)) {
    if (body.dry_run === false) {
      await ensureImportedChannelRows(result.channels);
    }
    result.channels = await annotateChannelsWithTeam(result.channels);
  }
  return successResponse(result);
});
