// The reviewer's diff bundle for a draft run: for each changed path, the prior
// live body (what's on the wiki now) and the drafted body (what the run wrote),
// so a human can decide approve/reject without reading the agent's raw log.

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
  const paths = await store.listDraftPaths(projectId, run.report_id);

  const pages = await Promise.all(
    paths.map(async (path) => {
      const history = await store.pageHistory(projectId, path);
      // Newest first. The draft body: the newest revision for this report.
      const draftRev = history.find((r) => r.report_id === run.report_id && r.status === "draft");
      // The prior live body: the newest revision older than the draft that
      // isn't itself a draft/rejected (i.e. what's actually on the wiki now).
      const draftIdx = draftRev ? history.indexOf(draftRev) : -1;
      const priorLiveRev = history
        .slice(draftIdx + 1)
        .find((r) => r.status !== "draft" && r.status !== "rejected");
      return {
        path,
        oldBody: priorLiveRev && !priorLiveRev.deleted ? priorLiveRev.markdown ?? "" : "",
        newBody: draftRev ? draftRev.markdown ?? "" : "",
        isNewPage: !priorLiveRev,
      };
    }),
  );

  return successResponse({ pages });
});
