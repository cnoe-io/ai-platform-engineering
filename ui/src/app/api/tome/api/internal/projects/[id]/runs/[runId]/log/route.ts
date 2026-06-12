// Internal agent callback: POST { line } → append an ingest-run log line.
// Matches agent/http_client.py append_log. Best-effort.

import { NextRequest } from "next/server";

import { withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; runId: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id, runId } = await ctx.params;
  const project = await resolveProject(id);
  const body = (await request.json().catch(() => ({}))) as { line?: string };
  if (typeof body.line === "string") {
    const runs = await getTomeIngestRunsCollection();
    await runs.updateOne(
      { _id: runId, project_id: project._id },
      { $push: { log: body.line } },
    );
  }
  return Response.json({ ok: true });
});
