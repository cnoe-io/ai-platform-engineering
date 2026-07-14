import { NextRequest } from "next/server";

import { ApiError,getAuthFromBearerOrSession,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { parseAdminSimulation } from "@/lib/rbac/admin-simulator";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { hasOrganizationAdmin } from "@/lib/rbac/platform-admin";
import { subjectFromSession } from "@/lib/rbac/resource-authz";
import {
computeWebexSpaceHealthSummaries,
type WebexSpaceHealthSummary,
} from "@/lib/rbac/webex-space-diagnostics";
import { listWebexSpaceGrants,webexWorkspaceRef } from "@/lib/rbac/webex-space-grant-store";
import { listWebexSpaceAgentRoutes } from "@/lib/rbac/webex-space-route-store";
import { requireAvailableWebexBotId } from "@/lib/webex-bot-catalog";

interface WebexSpaceTeamMappingDoc {
  bot_id: string;
  webex_workspace_id?: string;
  webex_space_id: string;
  space_name?: string;
  space_title?: string;
  team_id?: string;
  team_slug?: string;
  active?: boolean;
}

function pickPrimaryAgentId(
  routes: Awaited<ReturnType<typeof listWebexSpaceAgentRoutes>>,
): string | undefined {
  const enabledRoute = routes
    .filter((route) => route.enabled !== false)
    .sort(
      (left, right) =>
        (left.priority ?? 100) - (right.priority ?? 100) ||
        left.agent_id.localeCompare(right.agent_id)
    )[0];
  if (enabledRoute?.agent_id) return enabledRoute.agent_id;
  return undefined;
}

async function webexSpaceAccess(
  openfgaUser: string,
  workspaceId: string,
  spaceId: string
): Promise<{ canRead: boolean; canManage: boolean }> {
  const object = `webex_space:${workspaceId}--${spaceId}`;
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
    const simulation = parseAdminSimulation(request.nextUrl.searchParams);
    if (simulation.active && !(await hasOrganizationAdmin(session))) {
      throw new ApiError("Simulation requires organization admin access", 403);
    }
    const subject = simulation.subject?.openfga_user ?? subjectFromSession(session);
    // `?health=1` opts the caller in to a per-row diagnostics summary
    // (warnings count + OpenFGA reachability + last runtime error
    // timestamp). Mirrors the Slack channels endpoint so the shared
    // ConnectorAdminPanel can show real per-row health for Webex too.
    const includeHealth = request.nextUrl.searchParams.get("health") === "1";
    const botId = requireAvailableWebexBotId(request.nextUrl.searchParams.get("bot_id"));
    const mappings = await getRbacCollection<WebexSpaceTeamMappingDoc>("webexSpaceTeamMappings");
    const rows = await mappings
      .find({
        bot_id: botId,
        active: { $ne: false },
      } as never)
      .sort({ space_name: 1, space_title: 1 })
      .limit(500)
      .toArray();

    const visibleRows = (
      await Promise.all(
        rows.map(async (row) => {
          const workspaceId = webexWorkspaceRef(row.webex_workspace_id);
          const access = subject
            ? await webexSpaceAccess(subject, workspaceId, row.webex_space_id)
            : { canRead: false, canManage: false };
          if (!access.canRead) return null;
          return { row, workspaceId, access };
        })
      )
    ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const healthSummaries = includeHealth
      ? await computeWebexSpaceHealthSummaries(
          visibleRows.map(({ row, workspaceId }) => ({
            workspaceId,
            spaceId: row.webex_space_id,
          })),
          botId,
        ).catch(
          () =>
            visibleRows.map(
              (): WebexSpaceHealthSummary => ({
                warnings_count: 0,
                openfga_reachable: false,
                last_runtime_error_ts: null,
              }),
            ),
        )
      : [];

    const spaces = await Promise.all(
      visibleRows.map(async ({ row, workspaceId, access }, index) => {
        const [grants, routes] = await Promise.all([
          listWebexSpaceGrants(workspaceId, row.webex_space_id),
          listWebexSpaceAgentRoutes(workspaceId, row.webex_space_id, botId),
        ]);
        const health = includeHealth ? healthSummaries[index] : undefined;
        return {
          workspace_id: workspaceId,
          space_id: row.webex_space_id,
          space_name: row.space_name ?? row.space_title ?? row.webex_space_id,
          team_id: row.team_id,
          team_slug: row.team_slug,
          bot_id: row.bot_id,
          primary_agent_id: pickPrimaryAgentId(routes),
          active_grants: grants.length,
          can_manage: access.canManage,
          ...(health ? { health } : {}),
        };
      })
    );

    return successResponse({ spaces: spaces.filter((space): space is NonNullable<typeof space> => space !== null) });
});
