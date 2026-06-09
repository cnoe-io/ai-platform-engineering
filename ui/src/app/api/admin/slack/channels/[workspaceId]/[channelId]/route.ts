import { NextRequest } from "next/server";

import { ApiError,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { deleteExactOpenFgaTuples,readOpenFgaTuples,type OpenFgaTupleKey } from "@/lib/rbac/openfga";
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

// Read every stored tuple matching a partial key, following pagination.
async function readAllTuples(filter: Partial<OpenFgaTupleKey>): Promise<OpenFgaTupleKey[]> {
  const keys: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await readOpenFgaTuples({
      tuple: filter,
      pageSize: 100,
      ...(continuationToken ? { continuationToken } : {}),
    });
    for (const tuple of result.tuples) keys.push(tuple.key);
    continuationToken = result.continuationToken;
  } while (continuationToken);
  return keys;
}

// Every tuple touching a channel encodes it as `slack_channel:<ws>--<ch>` —
// either in the `user` field (channel→resource grants, e.g. the channel may
// `use` agent:x) or in the `object` field (team→channel visibility, e.g.
// team:<slug>#member is a `user` of the channel). Two server-side filtered
// reads (by user, by object) scope the scan to this channel's tuples instead
// of paging the whole store; we union and dedup the two directions.
// Object types a slack_channel can be granted access to (i.e. types where the
// channel appears as the tuple `user`). Derived from the authorization model's
// directly_related_user_types that reference slack_channel. OpenFGA's /read
// requires an object TYPE in the filter, so to find "tuples where this channel
// is the user" we must scope each read to a specific object type — a user-only
// filter 400s ("object type field is required"). Keep this in sync with the
// model if a new resource type starts granting slack_channel subjects.
const CHANNEL_USABLE_OBJECT_TYPES = [
  "agent",
  "mcp_server",
  "tool",
  "knowledge_base",
  "document",
  "skill",
] as const;

async function listChannelTuples(workspaceId: string, channelId: string): Promise<OpenFgaTupleKey[]> {
  const channelRef = `slack_channel:${slackChannelSubjectId(workspaceId, channelId)}`;
  const reads = await Promise.all([
    // Channel-as-object: team→channel visibility tuples (channel is the object).
    // A bare object filter is valid because channelRef carries its type.
    readAllTuples({ object: channelRef }),
    // Channel-as-user: channel→resource grants, one read per usable object type
    // (OpenFGA needs the object type; `<type>:` + user returns all such tuples).
    ...CHANNEL_USABLE_OBJECT_TYPES.map((type) =>
      readAllTuples({ object: `${type}:`, user: channelRef }),
    ),
  ]);
  const seen = new Set<string>();
  const matches: OpenFgaTupleKey[] = [];
  for (const key of reads.flat()) {
    const dedup = `${key.user}\n${key.relation}\n${key.object}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    matches.push(key);
  }
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
