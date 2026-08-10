// assisted-by Codex Codex-sonnet-4-6
import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { deleteExactOpenFgaTuples, readOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import {
  deleteWebexSpaceGrants,
  webexSpaceSubjectId,
  webexWorkspaceRef,
} from "@/lib/rbac/webex-space-grant-store";
import { parseWebexSpaceRouteParams } from "@/lib/rbac/webex-space-openfga";
import { deleteWebexSpaceAgentRoutes } from "@/lib/rbac/webex-space-route-store";

import { withWebexSpaceRebacManageAuth } from "../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

interface WebexSpaceTeamMappingDoc {
  webex_workspace_id?: string;
  webex_space_id: string;
}

const WEBEX_SPACE_USABLE_OBJECT_TYPES = [
  "agent",
  "mcp_server",
  "tool",
  "knowledge_base",
  "data_source",
  "mcp_tool",
  "document",
  "skill",
  "task",
] as const;

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

async function listSpaceTuples(workspaceId: string, spaceId: string): Promise<OpenFgaTupleKey[]> {
  const spaceRef = `webex_space:${webexSpaceSubjectId(workspaceId, spaceId)}`;
  const reads = await Promise.all([
    readAllTuples({ object: spaceRef }),
    ...WEBEX_SPACE_USABLE_OBJECT_TYPES.map((type) =>
      readAllTuples({ object: `${type}:`, user: spaceRef }),
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

export { WEBEX_SPACE_USABLE_OBJECT_TYPES };

export const DELETE = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);

  return withWebexSpaceRebacManageAuth(request, async () => {
    const workspaceRef = webexWorkspaceRef(workspaceId);

    const tuples = await listSpaceTuples(workspaceId, spaceId);
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

    const mappings = await getRbacCollection<WebexSpaceTeamMappingDoc>("webexSpaceTeamMappings");
    const [routesDeleted, grantsDeleted, mappingResult] = await Promise.all([
      deleteWebexSpaceAgentRoutes(workspaceId, spaceId),
      deleteWebexSpaceGrants(workspaceId, spaceId),
      mappings.deleteMany({
        webex_workspace_id: workspaceRef,
        webex_space_id: spaceId,
      } as never),
    ]);

    return successResponse({
      deleted: {
        workspace_id: workspaceRef,
        space_id: spaceId,
        openfga_tuples: openfgaDeleted,
        routes: routesDeleted,
        grants: grantsDeleted,
        team_mappings: mappingResult.deletedCount ?? 0,
      },
    });
  }, { workspaceId, spaceId });
});
