import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { checkOpenFgaTuple,writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { requireAdminSurfaceManage } from "@/lib/rbac/require-openfga";
import { subjectFromSession } from "@/lib/rbac/resource-authz";
import { slackChannelTeamVisibilityRelationships } from "@/lib/rbac/slack-channel-rebac";
import {
computeSlackChannelHealthSummaries,
type SlackChannelHealthSummary,
} from "@/lib/rbac/slack-channel-diagnostics";
import { listSlackChannelGrants,slackWorkspaceRef } from "@/lib/rbac/slack-channel-grant-store";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
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

function pickPrimaryAgentId(routes: SlackChannelAgentRouteDocument[]): string | undefined {
  const enabledRoute = routes
    .filter((route) => route.enabled !== false)
    .sort(
      (left, right) =>
        (left.priority ?? 100) - (right.priority ?? 100) ||
        left.agent_id.localeCompare(right.agent_id)
    )[0];
  const agentId = enabledRoute?.agent_id;
  return typeof agentId === "string" && agentId.trim() ? agentId.trim() : undefined;
}

async function slackChannelAccess(
  openfgaUser: string,
  workspaceId: string,
  channelId: string,
  teamSlug?: string
): Promise<{ canRead: boolean; canManage: boolean }> {
  const object = `slack_channel:${workspaceId}--${channelId}`;
  const checkAccess = () => Promise.all([
    checkOpenFgaTuple({ user: openfgaUser, relation: "can_read", object }).catch(() => ({ allowed: false })),
    checkOpenFgaTuple({ user: openfgaUser, relation: "can_manage", object }).catch(() => ({ allowed: false })),
  ]);
  let [read, manage] = await checkAccess();
  let repairedManageGrant = false;
  if (read.allowed && !manage.allowed && teamSlug) {
    // assisted-by Codex Codex-sonnet-4-6
    // Older channel assignments may only have the team-member use tuple.
    // Re-materialize the central assignment policy so upgraded installs get
    // the new team-member manage tuple without a manual migration first.
    const repair = await writeOpenFgaTuples(
      buildUniversalRebacTupleDiff({
        writes: slackChannelTeamVisibilityRelationships(workspaceId, channelId, teamSlug),
        deletes: [],
      })
    ).catch((error) => {
      console.warn("[SlackChannels] Failed to repair team visibility tuples", {
        workspaceId,
        channelId,
        teamSlug,
        error,
      });
      return null;
    });
    repairedManageGrant = Boolean(repair?.enabled && repair.writes > 0);
    [read, manage] = await checkAccess();
  }
  return {
    canRead: read.allowed || manage.allowed || repairedManageGrant,
    canManage: manage.allowed || repairedManageGrant,
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

    const visibleRows = (
      await Promise.all(
        rows.map(async (row) => {
          const workspaceId = slackWorkspaceRef(row.slack_workspace_id);
          const access = subject
            ? await slackChannelAccess(subject, workspaceId, row.slack_channel_id, row.team_slug)
            : { canRead: false, canManage: false };
          // A Slack surface admin can see every channel row, including
          // team_mapping rows imported (config_sync) but not yet assigned to a
          // team — those have no per-channel OpenFGA grants yet, so canRead is
          // false, but the admin still needs to see them in order to onboard
          // them. Without this, an imported-but-unassigned channel is invisible
          // in the Configured Channels tab. Non-admins still require canRead.
          if (!access.canRead && !canManageSlackSurface) return null;
          return { row, workspaceId, access };
        })
      )
    ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const healthSummaries = includeHealth
      ? await computeSlackChannelHealthSummaries(
          visibleRows.map(({ row, workspaceId }) => ({
            workspaceId,
            channelId: row.slack_channel_id,
          })),
        ).catch(
          () =>
            visibleRows.map(
              (): SlackChannelHealthSummary => ({
                warnings_count: 0,
                openfga_reachable: false,
                last_runtime_error_ts: null,
              }),
            ),
        )
      : [];

    const channels = await Promise.all(
      visibleRows.map(async ({ row, workspaceId, access }, index) => {
        const [grants, routesForChannel] = await Promise.all([
          listSlackChannelGrants(workspaceId, row.slack_channel_id),
          routeCollection
            .find({ workspace_id: workspaceId, channel_id: row.slack_channel_id, status: "active" } as never)
            .toArray(),
        ]);
        const health = includeHealth ? healthSummaries[index] : undefined;
        return {
          workspace_id: workspaceId,
          channel_id: row.slack_channel_id,
          channel_name: row.channel_name ?? row.slack_channel_id,
          team_id: row.team_id,
          team_slug: row.team_slug,
          primary_agent_id: pickPrimaryAgentId(routesForChannel),
          active_grants: Math.max(grants.length, routesForChannel.length),
          can_manage: access.canManage || canManageSlackSurface,
          ...(health ? { health } : {}),
        };
      })
    );

    return successResponse({ channels: channels.filter((channel): channel is NonNullable<typeof channel> => channel !== null) });
});
