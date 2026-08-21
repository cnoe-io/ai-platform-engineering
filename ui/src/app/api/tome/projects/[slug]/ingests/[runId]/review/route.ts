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
      // Compare with what was actually visible immediately before this report
      // first touched the path. A report may write the same page more than
      // once, and revisions from rejected or still-pending reports were never
      // live wiki content.
      let oldestRunRevisionIdx = -1;
      for (let idx = 0; idx < history.length; idx += 1) {
        if (history[idx].report_id === run.report_id) oldestRunRevisionIdx = idx;
      }
      const priorLiveRev = history
        .slice(oldestRunRevisionIdx + 1)
        .find((revision) => revision.status === undefined || revision.status === "live");
      const isNewPage = !priorLiveRev || Boolean(priorLiveRev.deleted);
      return {
        path,
        oldBody: priorLiveRev && !priorLiveRev.deleted ? priorLiveRev.markdown ?? "" : "",
        newBody: runRev && !runRev.deleted ? runRev.markdown ?? "" : "",
        isNewPage,
      };
    }),
  );

  return successResponse({ pages });
});
