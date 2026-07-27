// Approve a draft ingest run: promotes its pages to "live". Editor-gated —
// same capability as triggering the ingest itself (no reviewer-vs-author
// separation of duties yet, see TOME #86).

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { approveDraftRun } from "@/lib/tome/ingest-runner";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; runId: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, runId } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId, project_id: tctx.projectId });
  if (!run) throw new ApiError("Ingest run not found", 404, "RUN_NOT_FOUND");
  if (run.status !== "awaiting_review") {
    throw new ApiError("Run is not awaiting review", 409, "RUN_NOT_AWAITING_REVIEW");
  }

  const reviewedBy = tctx.user.email ?? "unknown";
  await approveDraftRun(runId, reviewedBy);

  auditTome({
    action: "tome.ingest.approve",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { run_id: runId, reviewed_by: reviewedBy },
  });

  return successResponse({ ok: true });
});
