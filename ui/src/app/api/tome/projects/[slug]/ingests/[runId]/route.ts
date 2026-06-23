// One ingest run with its full log — polled by the live log viewer.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; runId: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, runId } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);

  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId, project_id: projectId });
  if (!run) {
    throw new ApiError("Ingest run not found", 404, "RUN_NOT_FOUND");
  }

  return successResponse({
    id: String(run._id),
    status: run.status,
    greenfield: run.greenfield,
    started_at: run.started_at,
    finished_at: run.finished_at ?? null,
    error: run.error ?? null,
    report_id: run.report_id ?? null,
    log: (run.log ?? []).join("\n"),
  });
});
