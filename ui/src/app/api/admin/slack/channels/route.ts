import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { listSlackChannelGrants, slackWorkspaceRef } from "@/lib/rbac/slack-channel-grant-store";
import { subjectFromSession } from "@/lib/rbac/resource-authz";
import { requireAdminSurfaceManage } from "@/lib/rbac/require-openfga";
import {
  computeSlackChannelHealthSummary,
  type SlackChannelHealthSummary,
} from "@/lib/rbac/slack-channel-diagnostics";
import type { SlackChannelAgentRouteDocument } from "@/lib/rbac/slack-channel-route-store";

interface ChannelTeamMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id: string;
  channel_name?: string;
  team_id?: string;
  team_slug?: string;
  active?: boolean;
}

interface ChannelListRow {
  slack_workspace_id?: string;
  slack_channel_id: string;
  channel_name?: string;
  team_id?: string;
  team_slug?: string;
  active?: boolean;
  source: "team_mapping" | "route_metadata";
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
    const canManageSlackSurface = await requireAdminSurfaceManage(session, "slack")
      .then(() => true)
      .catch(() => false);
    const mappings = await getCollection<ChannelTeamMappingDoc>("channel_team_mappings");
    const mappingRows = await mappings
      .find({ active: { $ne: false } } as never)
      .sort({ channel_name: 1 })
      .limit(500)
      .toArray();
    const rowByKey = new Map<string, ChannelListRow>();
    for (const row of mappingRows) {
      const workspaceId = slackWorkspaceRef(row.slack_workspace_id);
      rowByKey.set(`${workspaceId}/${row.slack_channel_id}`, { ...row, slack_workspace_id: workspaceId, source: "team_mapping" });
    }

    const routeCollection = await getCollection<SlackChannelAgentRouteDocument>("slack_channel_agent_routes");
    const routeRows = await routeCollection
      .find({ status: "active" } as never)
      .limit(1000)
      .toArray();
    for (const route of routeRows) {
      const workspaceId = slackWorkspaceRef(String(route.workspace_id ?? ""));
      const channelId = String(route.channel_id ?? "");
      if (!channelId) continue;
      const key = `${workspaceId}/${channelId}`;
      if (!rowByKey.has(key)) {
        rowByKey.set(key, {
          slack_workspace_id: workspaceId,
          slack_channel_id: channelId,
          channel_name: channelId,
          source: "route_metadata",
        });
      }
    }

    const rows = Array.from(rowByKey.values())
      .sort((left, right) => (left.channel_name ?? left.slack_channel_id).localeCompare(right.channel_name ?? right.slack_channel_id))
      .slice(0, 500);

    const channels = await Promise.all(
      rows.map(async (row) => {
        const workspaceId = slackWorkspaceRef(row.slack_workspace_id);
        const access = subject
          ? await slackChannelAccess(subject, workspaceId, row.slack_channel_id)
          : { canRead: false, canManage: false };
        if (!access.canRead && !(row.source === "route_metadata" && canManageSlackSurface)) return null;
        const [grants, routesForChannel, health] = await Promise.all([
          listSlackChannelGrants(workspaceId, row.slack_channel_id),
          routeCollection
            .find({ workspace_id: workspaceId, channel_id: row.slack_channel_id, status: "active" } as never)
            .toArray(),
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
          active_grants: Math.max(grants.length, routesForChannel.length),
          can_manage: access.canManage || (row.source === "route_metadata" && canManageSlackSurface),
          ...(health ? { health } : {}),
        };
      })
    );

    return successResponse({ channels: channels.filter((channel): channel is NonNullable<typeof channel> => channel !== null) });
});
