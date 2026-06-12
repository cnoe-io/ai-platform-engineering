// Internal agent callback: GET the project snapshot.
// Path matches agent/http_client.py: {TTT_BACKEND_URL}/api/internal/projects/{id}/snapshot
// (with TTT_BACKEND_URL = http://<host>/api/tome).

import { NextRequest } from "next/server";

import { withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";
import { buildSnapshotFromProject } from "@/lib/tome/agent-proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The agent does `ProjectSnapshot.model_validate(resp.json())`, so this MUST
// return the snapshot object itself (not a {success,data} envelope).
export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id } = await ctx.params;
  const project = await resolveProject(id);
  return Response.json(buildSnapshotFromProject(project));
});
