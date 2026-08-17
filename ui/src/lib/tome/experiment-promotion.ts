/** Copy one explicitly selected experiment artifact into normal draft review. */

import { randomUUID } from "node:crypto";

import {
  claimExperimentPromotion,
  getEvidenceBundle,
  getExperiment,
  getExperimentArtifact,
  listArtifactEvaluations,
  releaseExperimentPromotion,
} from "@/lib/tome/evaluation-store";
import { isIngestRunning, setProjectLocked } from "@/lib/tome/ingest-runner";
import { getTomeIngestRunsCollection, getTomeReportsCollection } from "@/lib/tome/mongo-collections";
import { isSelectedPageEvaluation } from "@/lib/tome/experiment-page-scope";
import { getPageStore } from "@/lib/tome/page-store";
import type { IngestRun, Report } from "@/types/tome";

function reviewTimeoutMs(): number {
  const raw = Number(process.env.TOME_DRAFT_REVIEW_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
}

export async function promoteExperimentWinner(input: {
  experimentId: string;
  artifactId: string;
  actor: string;
}): Promise<{ runId: string; projectSlug: string }> {
  const [experiment, artifact] = await Promise.all([
    getExperiment(input.experimentId),
    getExperimentArtifact(input.artifactId),
  ]);
  if (!experiment || !artifact || artifact.experiment_id !== experiment._id) {
    throw new Error("Experiment artifact not found.");
  }
  if (isSelectedPageEvaluation(experiment.config)) {
    throw new Error(
      "Selected-page evaluations cannot promote a project-wide winner. Run an all-pages evaluation first.",
    );
  }
  if (!["completed", "completed_with_errors", "stopped_cost_ceiling", "stopped_by_user"]
    .includes(experiment.status)) {
    throw new Error("The experiment must finish before a winner can be selected.");
  }
  if (experiment.promoted_run_id) throw new Error("This experiment already has a promoted winner.");
  const evaluations = await listArtifactEvaluations(experiment._id);
  const evaluation = evaluations.find((value) => value.artifact_id === artifact._id);
  if (!evaluation) throw new Error("The selected artifact has not been evaluated.");
  if (evaluation.status === "error" || evaluation.status === "partial") {
    throw new Error("The selected artifact must have a complete evaluation.");
  }
  if (await isIngestRunning(experiment.project_id)) {
    throw new Error("This entity already has a run in progress or awaiting review.");
  }
  const bundle = await getEvidenceBundle(experiment.evidence_bundle_id);
  if (!bundle || bundle.content_hash !== experiment.evidence_hash) {
    throw new Error("The experiment evidence bundle is missing or does not match its hash.");
  }
  const baseline = Object.fromEntries(
    bundle.items
      .filter((item) => item.workspace_project_id === experiment.project_id && item.page_path)
      .map((item) => [item.page_path!, item.content]),
  );
  const changed = Object.fromEntries(
    artifact.pages
      .filter((page) => baseline[page.path] !== page.markdown)
      .map((page) => [page.path, page.markdown]),
  );
  if (Object.keys(changed).length === 0) throw new Error("The selected artifact changed no pages.");

  const reports = await getTomeReportsCollection();
  const runs = await getTomeIngestRunsCollection();
  const prior = await reports.find({ project_id: experiment.project_id })
    .sort({ version: -1 }).limit(1).next();
  const now = new Date();
  const reportId = randomUUID();
  const runId = randomUUID();
  const claimed = await claimExperimentPromotion({
    experimentId: experiment._id,
    candidate: artifact.candidate,
    artifactId: artifact._id,
    runId,
  });
  if (!claimed) throw new Error("This experiment already has a promoted winner.");
  const report: Report = {
    _id: reportId,
    project_id: experiment.project_id,
    version: (prior?.version ?? 0) + 1,
    summary: `Experiment winner ${artifact.blind_label}`,
    created_at: now,
  };
  const run: IngestRun = {
    _id: runId,
    project_id: experiment.project_id,
    report_id: reportId,
    status: "awaiting_review",
    greenfield: !prior,
    triggered_by: "manual",
    log: [
      `[--:--:--] ✓ Selected ${artifact.blind_label} from experiment ${experiment._id}`,
      `[--:--:--] · Evidence bundle ${bundle._id} (${bundle.content_hash})`,
    ],
    started_at: now,
    review_deadline: new Date(now.getTime() + reviewTimeoutMs()),
    model: artifact.model,
    model_provenance: {
      model: artifact.model,
      source: "experiment",
      scope_kind: "exact",
      scope_id: experiment._id,
      config_version: experiment.config_version,
    },
    quality_evaluation_id: evaluation._id,
    quality_policy_version: experiment.config.rubric_policy_version,
    quality_policy_scope: experiment.config.rubric_policy_scope,
    quality_policy_scope_id: experiment.config.rubric_policy_scope_id,
    quality_policy_mode: experiment.config.quality_policy_mode,
    quality_require_human_review: experiment.config.require_human_review,
    quality_allow_steward_override: experiment.config.allow_steward_override,
    quality_evaluator_model: experiment.config.evaluator_model,
    quality_rubric_policy: experiment.config.rubric_policy,
    evidence_bundle_id: experiment.evidence_bundle_id,
    evidence_hash: experiment.evidence_hash,
    quality_entity_type: experiment.config.entity_type,
    dispatch: { endpoint: `/${experiment.config.operation}`, skipReview: false },
  };
  try {
    await reports.insertOne(report);
    await runs.insertOne(run);
    await getPageStore().then((store) => store.writePages(experiment.project_id, changed, {
      message: `experiment winner ${experiment._id}`,
      author: input.actor,
      reportId,
      status: "draft",
    }));
    await setProjectLocked(experiment.project_id, true);
  } catch (error) {
    await getPageStore()
      .then((store) => store.rejectDraftReport(experiment.project_id, reportId))
      .catch(() => undefined);
    await setProjectLocked(experiment.project_id, false).catch(() => undefined);
    await Promise.all([
      reports.deleteOne({ _id: reportId }),
      runs.deleteOne({ _id: runId }),
      releaseExperimentPromotion(experiment._id, runId),
    ]);
    throw error;
  }
  return { runId, projectSlug: experiment.project_slug };
}
