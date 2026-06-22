import type { Document } from "mongodb";
import { NextRequest } from "next/server";

import { ApiError,getAuthFromBearerOrSession,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { slackWorkspaceRef } from "@/lib/rbac/slack-channel-grant-store";
import { slackChannelTeamVisibilityRelationships } from "@/lib/rbac/slack-channel-rebac";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import type { Team } from "@/types/teams";

import { withSlackChannelRebacManageAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

interface ChannelTeamMappingDoc extends Document {
  slack_workspace_id?: string;
  slack_channel_id: string;
  channel_name?: string;
  team_id?: string;
  team_slug?: string;
  active?: boolean;
}

function teamSlug(team: Team, fallback: string): string {
  return typeof team.slug === "string" && team.slug.trim() ? team.slug.trim() : fallback;
}

export const PUT = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { workspaceId, channelId } = await context.params;
  return withSlackChannelRebacManageAuth(request, async () => {
    const { session } = await getAuthFromBearerOrSession(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const teamSlugInput = typeof body.team_slug === "string" ? body.team_slug.trim() : "";
    if (!teamSlugInput) throw new ApiError("team_slug is required", 400);

    const teams = await getCollection<Team>("teams");
    const team = await teams.findOne({ slug: teamSlugInput } as never);
    if (!team) throw new ApiError(`Team ${teamSlugInput} was not found`, 404);
    const resolvedTeamSlug = teamSlug(team, teamSlugInput);
    const teamId = String(team._id ?? "");
    const workspaceRef = slackWorkspaceRef(workspaceId);
    const channelName = typeof body.channel_name === "string" && body.channel_name.trim()
      ? body.channel_name.trim()
      : channelId;

    const mappings = await getCollection<ChannelTeamMappingDoc>("channel_team_mappings");
    const existing = await mappings.findOne({
      slack_workspace_id: workspaceRef,
      slack_channel_id: channelId,
      active: { $ne: false },
    } as never);

    const writes = slackChannelTeamVisibilityRelationships(workspaceRef, channelId, resolvedTeamSlug);
    const deletes = existing?.team_slug && existing.team_slug !== resolvedTeamSlug
      ? slackChannelTeamVisibilityRelationships(workspaceRef, channelId, existing.team_slug)
      : [];
    const openfga = await writeOpenFgaTuples(buildUniversalRebacTupleDiff({ writes, deletes }));
    if (!openfga.enabled) throw new ApiError("OpenFGA is not configured", 502);

    const now = new Date();
    await mappings.updateOne(
      {
        slack_workspace_id: workspaceRef,
        slack_channel_id: channelId,
        active: { $ne: false },
      } as never,
      {
        $set: {
          slack_workspace_id: workspaceRef,
          slack_channel_id: channelId,
          channel_name: channelName,
          team_id: teamId,
          team_slug: resolvedTeamSlug,
          active: true,
          updated_at: now,
          updated_by: session?.user?.email ?? "api",
        },
        $setOnInsert: {
          created_at: now,
          created_by: session?.user?.email ?? "api",
        },
      } as never,
      { upsert: true },
    );

    return successResponse({
      workspace_id: workspaceRef,
      channel_id: channelId,
      channel_name: channelName,
      team_id: teamId,
      team_slug: resolvedTeamSlug,
    });
  }, { workspaceId, channelId });
});
