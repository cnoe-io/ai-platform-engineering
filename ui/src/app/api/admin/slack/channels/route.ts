import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { listSlackChannelGrants, slackWorkspaceRef } from "@/lib/rbac/slack-channel-grant-store";
import { subjectFromSession } from "@/lib/rbac/resource-authz";
import {
  computeSlackChannelHealthSummary,
  type SlackChannelHealthSummary,
} from "@/lib/rbac/slack-channel-diagnostics";

interface ChannelTeamMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id: string;
  channel_name?: string;
  team_id?: string;
  team_slug?: string;
  active?: boolean;
}

async function slackChannelAccess(
  openfgaUser: string,
  workspaceId: string,
  channelId: string
): Promise<{ canRead: boolean; canManage: boolean }> {
  const object = `slack_channel:${workspaceId}--${channelId}`;
  const [read, manage] = await Promise.all([
    checkOpenFgaTuple({ user: openfgaUser, relation: "can_read", object }).catch(() => ({ allowed: false })),
    checkOpenFgaTuple({ user: openfgaUser, relation: "can_manage", object }).catch(() => ({ allowed: false })),
  ]);
  return {
    canRead: read.allowed || manage.allowed,
    canManage: manage.allowed,
  };
}

export const GET = withErrorHandler(async (request: NextRequest) => {
    const { session } = await getAuthFromBearerOrSession(request);
    const subject = subjectFromSession(session);
    // `?health=1` opts the caller in to a per-row diagnostics summary
    // (warnings count + OpenFGA reachability + last runtime error
    // timestamp). Computed in parallel server-side so a workspace with
    // dozens of channels stays under one round-trip from the UI's
    // perspective.
    const includeHealth = request.nextUrl.searchParams.get("health") === "1";
    const mappings = await getCollection<ChannelTeamMappingDoc>("channel_team_mappings");
    const rows = await mappings
      .find({ active: { $ne: false } } as never)
      .sort({ channel_name: 1 })
      .limit(500)
      .toArray();

    const channels = await Promise.all(
      rows.map(async (row) => {
        const workspaceId = slackWorkspaceRef(row.slack_workspace_id);
        const access = subject
          ? await slackChannelAccess(subject, workspaceId, row.slack_channel_id)
          : { canRead: false, canManage: false };
        if (!access.canRead) return null;
        const [grants, health] = await Promise.all([
          listSlackChannelGrants(workspaceId, row.slack_channel_id),
          includeHealth
            ? computeSlackChannelHealthSummary(workspaceId, row.slack_channel_id).catch(
                (): SlackChannelHealthSummary => ({
                  warnings_count: 0,
                  openfga_reachable: false,
                  last_runtime_error_ts: null,
                }),
              )
            : Promise.resolve(undefined),
        ]);
        return {
          workspace_id: workspaceId,
          channel_id: row.slack_channel_id,
          channel_name: row.channel_name ?? row.slack_channel_id,
          team_id: row.team_id,
          team_slug: row.team_slug,
          active_grants: grants.length,
          can_manage: access.canManage,
          ...(health ? { health } : {}),
        };
      })
    );

    return successResponse({ channels: channels.filter((channel): channel is NonNullable<typeof channel> => channel !== null) });
});
