import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { subjectFromSession } from "@/lib/rbac/resource-authz";
import {
computeWebexSpaceHealthSummary,
type WebexSpaceHealthSummary,
} from "@/lib/rbac/webex-space-diagnostics";
import { listWebexSpaceGrants,webexWorkspaceRef } from "@/lib/rbac/webex-space-grant-store";

interface WebexSpaceTeamMappingDoc {
  webex_workspace_id?: string;
  webex_space_id: string;
  space_name?: string;
  space_title?: string;
  team_id?: string;
  team_slug?: string;
  active?: boolean;
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
    const subject = subjectFromSession(session);
    // `?health=1` opts the caller in to a per-row diagnostics summary
    // (warnings count + OpenFGA reachability + last runtime error
    // timestamp). Mirrors the Slack channels endpoint so the shared
    // ConnectorAdminPanel can show real per-row health for Webex too.
    const includeHealth = request.nextUrl.searchParams.get("health") === "1";
    const mappings = await getRbacCollection<WebexSpaceTeamMappingDoc>("webexSpaceTeamMappings");
    const rows = await mappings
      .find({ active: { $ne: false } } as never)
      .sort({ space_name: 1, space_title: 1 })
      .limit(500)
      .toArray();

    const spaces = await Promise.all(
      rows.map(async (row) => {
        const workspaceId = webexWorkspaceRef(row.webex_workspace_id);
        const access = subject
          ? await webexSpaceAccess(subject, workspaceId, row.webex_space_id)
          : { canRead: false, canManage: false };
        if (!access.canRead) return null;
        const [grants, health] = await Promise.all([
          listWebexSpaceGrants(workspaceId, row.webex_space_id),
          includeHealth
            ? computeWebexSpaceHealthSummary(workspaceId, row.webex_space_id).catch(
                (): WebexSpaceHealthSummary => ({
                  warnings_count: 0,
                  openfga_reachable: false,
                  last_runtime_error_ts: null,
                }),
              )
            : Promise.resolve(undefined),
        ]);
        return {
          workspace_id: workspaceId,
          space_id: row.webex_space_id,
          space_name: row.space_name ?? row.space_title ?? row.webex_space_id,
          team_id: row.team_id,
          team_slug: row.team_slug,
          active_grants: grants.length,
          can_manage: access.canManage,
          ...(health ? { health } : {}),
        };
      })
    );

    return successResponse({ spaces: spaces.filter((space): space is NonNullable<typeof space> => space !== null) });
});
