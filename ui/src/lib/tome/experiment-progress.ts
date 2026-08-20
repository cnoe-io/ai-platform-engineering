import type {
  ArtifactEvaluation,
  ExperimentArtifact,
  ExperimentConfig,
  ExperimentStatus,
  ExperimentTrial,
} from "@/types/tome-evaluation";

type ProgressExperiment = {
  status: ExperimentStatus;
  trials: ExperimentTrial[];
  config: Pick<ExperimentConfig, "repeat_count" | "evaluator_model">;
};

type ProgressArtifact = Pick<
  ExperimentArtifact,
  "_id" | "trial" | "candidate" | "blind_label" | "model" | "pages"
>;

type ProgressEvaluation = Pick<ArtifactEvaluation, "artifact_id">;

export interface ExperimentProgressView {
  completedSteps: number;
  totalSteps: number;
  percent: number;
  title: string;
  trial: number | null;
  model: string | null;
  evaluatorModel: string | null;
  pages: string[];
  active: boolean;
}

const GENERATION_DONE = new Set<ExperimentTrial["status"]>([
  "succeeded",
  "failed",
  "not_started",
]);

function artifactPages(
  artifacts: ProgressArtifact[],
  trial: ExperimentTrial | undefined,
): string[] {
  if (!trial) return [];
  return artifacts
    .find((artifact) => artifact._id === trial.artifact_id)
    ?.pages.map((page) => page.path) ?? [];
}

export function buildExperimentProgress(
  experiment: ProgressExperiment,
  artifacts: ProgressArtifact[],
  evaluations: ProgressEvaluation[],
): ExperimentProgressView {
  const totalSteps = Math.max(0, experiment.config.repeat_count * 4);
  const evaluatedArtifacts = new Set(evaluations.map((evaluation) => evaluation.artifact_id));
  let completedSteps = 0;

  for (const trial of experiment.trials) {
    if (GENERATION_DONE.has(trial.status)) completedSteps += 1;
    if (evaluatedArtifacts.has(trial.artifact_id)
      || trial.status === "failed"
      || trial.status === "not_started") {
      completedSteps += 1;
    }
  }

  if (["completed", "completed_with_errors"].includes(experiment.status)) {
    completedSteps = totalSteps;
  }
  completedSteps = Math.min(completedSteps, totalSteps);
  const percent = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);
  const active = ["queued", "running", "evaluating"].includes(experiment.status);

  if (experiment.status === "queued") {
    return {
      completedSteps,
      totalSteps,
      percent,
      title: "Waiting to start",
      trial: 1,
      model: null,
      evaluatorModel: null,
      pages: [],
      active,
    };
  }

  if (experiment.status === "running") {
    const runningTrial = experiment.trials.find((trial) => trial.status === "running");
    return {
      completedSteps,
      totalSteps,
      percent,
      title: runningTrial ? "Generating candidate output" : "Preparing the next candidate",
      trial: runningTrial?.trial ?? null,
      model: runningTrial?.model ?? null,
      evaluatorModel: null,
      pages: artifactPages(artifacts, runningTrial),
      active,
    };
  }

  if (experiment.status === "evaluating") {
    const eligibleArtifacts = artifacts
      .filter((artifact) => {
        const trial = experiment.trials.find((value) => value.artifact_id === artifact._id);
        return trial?.status === "succeeded" && !evaluatedArtifacts.has(artifact._id);
      })
      .sort((left, right) => left.trial - right.trial
        || left.blind_label.localeCompare(right.blind_label));
    const activeArtifact = eligibleArtifacts[0];
    return {
      completedSteps,
      totalSteps,
      percent,
      title: activeArtifact ? "Evaluating candidate output" : "Finalizing evaluation results",
      trial: activeArtifact?.trial ?? null,
      model: activeArtifact?.model ?? null,
      evaluatorModel: activeArtifact ? experiment.config.evaluator_model : null,
      pages: activeArtifact?.pages.map((page) => page.path) ?? [],
      active,
    };
  }

  const terminalTitles: Record<Exclude<ExperimentStatus, "queued" | "running" | "evaluating">, string> = {
    completed: "Evaluation completed",
    completed_with_errors: "Evaluation completed with errors",
    stopped_by_user: "Evaluation stopped by user",
    stopped_cost_ceiling: "Evaluation stopped at cost ceiling",
    failed: "Evaluation failed",
  };
  return {
    completedSteps,
    totalSteps,
    percent,
    title: terminalTitles[experiment.status],
    trial: null,
    model: null,
    evaluatorModel: null,
    pages: [],
    active,
  };
}
