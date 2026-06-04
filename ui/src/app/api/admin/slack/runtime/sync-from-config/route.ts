import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { writeOpenFgaTupleDiff, buildUniversalRebacTupleDiff } from "@/lib/rbac/openfga";
import { slackChannelTeamVisibilityRelationships } from "@/lib/rbac/slack-channel-rebac";
import { slackWorkspaceRef } from "@/lib/rbac/slack-channel-grant-store";
import { callSlackBotAdmin } from "@/lib/slack-bot-admin";
import type { Team } from "@/types/teams";

interface ChannelTeamMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id: string;
  channel_name?: string;
  team_slug?: string;
  team_id?: string;
  active?: boolean;
}

interface SyncPreviewChannel {
  workspace_id?: string;
  channel_id?: string;
  channel_name?: string;
  /** Optional owning team slug from the YAML config (channel-level `team:`). */
  team?: string;
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

  // Resolve any team slugs the config provided to their team docs, so we can
  // bind the channel to a team on import (sets team_slug/team_id + writes the
  // channel→team ReBAC tuples) rather than leaving it team-less and unusable.
  const teamSlugs = Array.from(
    new Set(
      channels
        .map((c) => (typeof c.team === "string" ? c.team.trim() : ""))
        .filter((slug) => slug.length > 0),
    ),
  );
  const teamBySlug = new Map<string, Team>();
  if (teamSlugs.length > 0) {
    const teamsCol = await getCollection<Team>("teams");
    const teamDocs = await teamsCol.find({ slug: { $in: teamSlugs } } as never).toArray();
    for (const team of teamDocs) teamBySlug.set(team.slug, team);
  }

  for (const channel of channels) {
    if (!channel.channel_id) continue;
    const workspaceRef = slackWorkspaceRef(channel.workspace_id ? String(channel.workspace_id) : undefined);
    const channelId = String(channel.channel_id);

    // If the config named a team and it exists, bind the channel to it.
    const requestedSlug = typeof channel.team === "string" ? channel.team.trim() : "";
    const team = requestedSlug ? teamBySlug.get(requestedSlug) : undefined;
    if (requestedSlug && !team) {
      console.warn(
        `[slack-sync] channel ${channelId} requests team '${requestedSlug}' which does not exist — importing without a team binding`,
      );
    }

    const setOnInsert: Record<string, unknown> = {
      slack_workspace_id: workspaceRef,
      slack_channel_id: channelId,
      active: true,
      source_type: "config_sync",
      created_at: now,
    };
    const set: Record<string, unknown> = {
      channel_name: channel.channel_name ? String(channel.channel_name) : channelId,
      updated_at: now,
    };
    if (team) {
      set.team_slug = team.slug;
      set.team_id = String(team._id);
    }

    await mappings.updateOne(
      {
        slack_workspace_id: workspaceRef,
        slack_channel_id: channelId,
        active: { $ne: false },
      } as never,
      { $set: set, $setOnInsert: setOnInsert } as never,
      { upsert: true },
    );

    // Write the channel→team ReBAC tuples (team#member→use, team#admin→manage)
    // so the channel is actually authorized for the team's members. Without
    // these the mapping exists but the bot's channel ReBAC check still denies.
    if (team) {
      try {
        await writeOpenFgaTupleDiff(
          buildUniversalRebacTupleDiff({
            writes: slackChannelTeamVisibilityRelationships(workspaceRef, channelId, team.slug),
            deletes: [],
          }),
        );
      } catch (error) {
        console.warn(
          `[slack-sync] failed to write channel→team OpenFGA tuples for ${channelId} → ${team.slug}:`,
          error,
        );
      }
    }
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
