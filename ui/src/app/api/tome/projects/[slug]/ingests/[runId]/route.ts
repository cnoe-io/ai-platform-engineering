// One ingest run with its full log — polled by the live log viewer.
// DELETE cancels a running run (marks it failed; background stream self-terminates).

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { cancelRun } from "@/lib/tome/ingest-runner";
import { getArtifactEvaluation } from "@/lib/tome/evaluation-store";

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

  const qualityEvaluation = run.quality_evaluation_id
    ? await getArtifactEvaluation(run.quality_evaluation_id)
    : null;
  return successResponse({
    id: String(run._id),
    status: run.status,
    greenfield: run.greenfield,
    started_at: run.started_at,
    finished_at: run.finished_at ?? null,
    error: run.error ?? null,
    report_id: run.report_id ?? null,
    cascade_id: run.cascade_id ?? null,
    cascade_role: run.cascade_role ?? null,
    review_deadline: run.review_deadline ?? null,
    review_outcome: run.review_outcome ?? null,
    reviewed_by: run.reviewed_by ?? null,
    usage: run.usage ?? null,
    model: run.model ?? null,
    model_provenance: run.model_provenance ?? null,
    context_usage: run.context_usage ?? null,
    quality_policy: run.quality_policy_mode
      ? {
          mode: run.quality_policy_mode,
          version: run.quality_policy_version ?? null,
          scope: run.quality_policy_scope ?? null,
          scope_id: run.quality_policy_scope_id ?? null,
          require_human_review: run.quality_require_human_review ?? false,
          allow_steward_override: run.quality_allow_steward_override ?? false,
        }
      : null,
    quality_evaluation: qualityEvaluation,
    log: (run.log ?? []).join("\n"),
  });
});

export const DELETE = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, runId } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  const { projectId } = tctx;

  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId, project_id: projectId });
  if (!run) throw new ApiError("Ingest run not found", 404, "RUN_NOT_FOUND");
  if (run.status !== "running" && run.status !== "queued") {
    throw new ApiError("Run is not active", 409, "RUN_NOT_ACTIVE");
  }

  await runs.updateOne(
    { _id: runId },
    { $set: { status: "failed", error: "Stopped by user", finished_at: new Date() } },
  );
  // Actually tear down the agent stream — without this, the DB flip above is
  // cosmetic: the background fetch (and the agent's real work) keeps running
  // and can starve/no-op a subsequent run dispatched for the same project.
  cancelRun(runId);

  auditTome({
    action: "tome.ingest.cancel",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { run_id: runId },
  });

  return successResponse({ ok: true });
});
