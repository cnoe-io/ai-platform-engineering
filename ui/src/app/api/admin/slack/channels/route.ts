import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { listSlackChannelGrants } from "@/lib/rbac/slack-channel-grant-store";

import { withSlackChannelRebacViewAuth } from "./_lib";

interface ChannelTeamMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id: string;
  channel_name?: string;
  team_id?: string;
  team_slug?: string;
  active?: boolean;
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withSlackChannelRebacViewAuth(request, async () => {
    const mappings = await getCollection<ChannelTeamMappingDoc>("channel_team_mappings");
    const rows = await mappings
      .find({ active: { $ne: false } } as never)
      .sort({ channel_name: 1 })
      .limit(500)
      .toArray();

    const channels = await Promise.all(
      rows.map(async (row) => {
        const workspaceId = row.slack_workspace_id ?? "unknown";
        const grants = await listSlackChannelGrants(workspaceId, row.slack_channel_id);
        return {
          workspace_id: workspaceId,
          channel_id: row.slack_channel_id,
          channel_name: row.channel_name ?? row.slack_channel_id,
          team_id: row.team_id,
          team_slug: row.team_slug,
          active_grants: grants.length,
        };
      })
    );

    return successResponse({ channels });
  })
);
