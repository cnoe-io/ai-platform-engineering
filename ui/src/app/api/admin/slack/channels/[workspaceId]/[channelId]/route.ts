import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { deleteExactOpenFgaTuples, readOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import {
  deleteSlackChannelGrants,
  slackChannelSubjectId,
  slackWorkspaceRef,
} from "@/lib/rbac/slack-channel-grant-store";
import { deleteSlackChannelAgentRoutes } from "@/lib/rbac/slack-channel-route-store";

import { withSlackChannelRebacManageAuth } from "../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

// Every tuple touching a channel encodes it as `slack_channel:<ws>--<ch>` —
// either in the `user` field (channel→resource grants, e.g. the channel may
// `use` agent:x) or in the `object` field (team→channel visibility, e.g.
// team:<slug>#member is a `user` of the channel). A single read-all pass
// catches both directions; we match the channel string against both fields.
async function listChannelTuples(workspaceId: string, channelId: string): Promise<OpenFgaTupleKey[]> {
  const channelRef = `slack_channel:${slackChannelSubjectId(workspaceId, channelId)}`;
  const matches: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await readOpenFgaTuples({
      pageSize: 100,
      ...(continuationToken ? { continuationToken } : {}),
    });
    for (const tuple of result.tuples) {
      if (tuple.key.user === channelRef || tuple.key.object === channelRef) {
        matches.push(tuple.key);
      }
    }
    continuationToken = result.continuationToken;
  } while (continuationToken);
  return matches;
}

interface ChannelTeamMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id: string;
}

// Hard-delete a channel: remove every OpenFGA tuple that references it (both
// directions) and purge its Mongo metadata across all three collections
// (routes, grants, team mapping). OpenFGA is cleared first so a failure there
// aborts before Mongo is touched — leaving the channel visible and the delete
// safely re-runnable. The reverse order could orphan access-granting tuples
// with no UI row left to clean them up.
//
// Does not force a Slack bot cache reload (matching the per-route DELETE);
// the cache expires on its TTL, or an admin can use "Reload Bot Cache".
export const DELETE = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const { workspaceId, channelId } = await context.params;
  return withSlackChannelRebacManageAuth(request, async () => {
    const workspaceRef = slackWorkspaceRef(workspaceId);

    const tuples = await listChannelTuples(workspaceId, channelId);
    let openfgaDeleted = 0;
    try {
      const result = await deleteExactOpenFgaTuples(tuples);
      if (!result.enabled) throw new Error("OpenFGA is not configured");
      openfgaDeleted = result.deletes;
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? `OpenFGA tuple delete failed: ${error.message}` : "OpenFGA tuple delete failed",
        502,
      );
    }

    const mappings = await getCollection<ChannelTeamMappingDoc>("channel_team_mappings");
    const [routesDeleted, grantsDeleted, mappingResult] = await Promise.all([
      deleteSlackChannelAgentRoutes(workspaceId, channelId),
      deleteSlackChannelGrants(workspaceId, channelId),
      mappings.deleteMany({
        slack_workspace_id: workspaceRef,
        slack_channel_id: channelId,
      } as never),
    ]);

    return successResponse({
      deleted: {
        workspace_id: workspaceRef,
        channel_id: channelId,
        openfga_tuples: openfgaDeleted,
        routes: routesDeleted,
        grants: grantsDeleted,
        team_mappings: mappingResult.deletedCount ?? 0,
      },
    });
  }, { workspaceId, channelId });
});
