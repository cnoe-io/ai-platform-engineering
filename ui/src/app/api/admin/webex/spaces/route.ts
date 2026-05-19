import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { listWebexSpaceGrants, webexWorkspaceRef } from "@/lib/rbac/webex-space-grant-store";

import { withWebexSpaceRebacViewAuth } from "./_lib";

interface WebexSpaceTeamMappingDoc {
  webex_workspace_id?: string;
  webex_space_id: string;
  space_name?: string;
  space_title?: string;
  team_id?: string;
  team_slug?: string;
  active?: boolean;
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withWebexSpaceRebacViewAuth(request, async () => {
    const mappings = await getRbacCollection<WebexSpaceTeamMappingDoc>("webexSpaceTeamMappings");
    const rows = await mappings
      .find({ active: { $ne: false } } as never)
      .sort({ space_name: 1, space_title: 1 })
      .limit(500)
      .toArray();

    const spaces = await Promise.all(
      rows.map(async (row) => {
        const workspaceId = webexWorkspaceRef(row.webex_workspace_id);
        const grants = await listWebexSpaceGrants(workspaceId, row.webex_space_id);
        return {
          workspace_id: workspaceId,
          space_id: row.webex_space_id,
          space_name: row.space_name ?? row.space_title ?? row.webex_space_id,
          team_id: row.team_id,
          team_slug: row.team_slug,
          active_grants: grants.length,
        };
      })
    );

    return successResponse({ spaces });
  })
);
