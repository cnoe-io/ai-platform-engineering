// List ingest runs for a project (newest first) — run summaries for the
// Ingest history list.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);

  const runs = await getTomeIngestRunsCollection();
  const rows = await runs
    .find({ project_id: projectId })
    .sort({ started_at: -1 })
    .limit(50)
    .toArray();

  const summaries = rows.map((r) => ({
    id: String(r._id),
    status: r.status,
    greenfield: r.greenfield,
    started_at: r.started_at,
    finished_at: r.finished_at ?? null,
    log_lines: r.log?.length ?? 0,
    error: r.error ?? null,
  }));

  return successResponse({ runs: summaries });
});
