// Resolve a report_id (carried on PageRevision) to the ingest run that
// produced it, so a page-history view can link a revision to its run.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; reportId: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, reportId } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);

  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ project_id: projectId, report_id: reportId });
  if (!run) throw new ApiError("No run found for this report", 404, "RUN_NOT_FOUND");

  return successResponse({ run_id: String(run._id), status: run.status });
});
