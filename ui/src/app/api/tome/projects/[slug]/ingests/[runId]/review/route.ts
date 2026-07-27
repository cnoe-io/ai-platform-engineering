// The diff bundle for one run: for each changed path, the body before the run
// touched it and the body the run wrote, so a reviewer (or anyone browsing
// history later) can see what a run changed without reading its raw log.
// Works for any run — a draft awaiting review, or one long since terminal.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getPageStore } from "@/lib/tome/page-store";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; runId: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, runId } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);

  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId, project_id: projectId });
  if (!run) throw new ApiError("Ingest run not found", 404, "RUN_NOT_FOUND");
  if (!run.report_id) return successResponse({ pages: [] });

  const store = await getPageStore();
  const paths = await store.listTouchedPaths(projectId, run.report_id);

  const pages = await Promise.all(
    paths.map(async (path) => {
      const history = await store.pageHistory(projectId, path);
      // Newest first. The run's own write: the newest revision for this report.
      const runRev = history.find((r) => r.report_id === run.report_id);
      // What was on the wiki right before the run touched this path: the
      // newest revision older than the run's write (any status — reading
      // history, not gating a live read).
      const runIdx = runRev ? history.indexOf(runRev) : -1;
      const priorRev = history.slice(runIdx + 1)[0];
      return {
        path,
        oldBody: priorRev && !priorRev.deleted ? priorRev.markdown ?? "" : "",
        newBody: runRev && !runRev.deleted ? runRev.markdown ?? "" : "",
        isNewPage: !priorRev,
      };
    }),
  );

  return successResponse({ pages });
});
