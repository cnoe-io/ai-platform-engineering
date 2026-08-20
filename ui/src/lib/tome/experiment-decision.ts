import { buildPageEvaluationView } from "@/lib/tome/page-evaluation";
import {
  isSelectedPageEvaluation,
  pageIsInEvaluationScope,
} from "@/lib/tome/experiment-page-scope";
import { evaluationQualityScore } from "@/lib/tome/rubric-evaluator";
import { rubricQualityScore } from "@/lib/tome/rubric-radar";
import type {
  ArtifactEvaluation,
  ArtifactFileEvaluation,
  ExperimentArtifact,
  ExperimentCandidate,
  TomeExperiment,
  TomeRubricId,
} from "@/types/tome-evaluation";

export const DECISION_HEATMAP_RUBRICS = [
  "claim_evidence",
  "citation_coverage",
  "grounding",
  "unsupported_claims",
  "contradictions",
  "attribution_integrity",
] as const satisfies readonly TomeRubricId[];

export const CLAIM_OUTCOME_KEYS = [
  "supported",
  "partially_supported",
  "unsupported",
  "contradicted",
  "unverifiable",
] as const;

export type ClaimOutcomeKey = typeof CLAIM_OUTCOME_KEYS[number];

export interface PairedTrialDecisionScore {
  trial: number;
  a: number;
  b: number;
  delta: number;
  winner: ExperimentCandidate | "tie";
}

export interface CandidateClaimOutcomes {
  candidate: ExperimentCandidate;
  model: string;
  counts: Record<ClaimOutcomeKey, number>;
  total: number;
}

export interface DecisionHeatmapCell {
  rubricId: TomeRubricId;
  a: number | null;
  b: number | null;
  delta: number | null;
  leader: ExperimentCandidate | "tie" | null;
}

export interface DecisionHeatmapRow {
  path: string;
  cells: DecisionHeatmapCell[];
}

export interface ExperimentDecisionRecommendation {
  candidate: ExperimentCandidate | null;
  title: string;
  evidenceLabel: string;
  reason: string;
  blockers: string[];
}

export interface ExperimentDecisionView {
  recommendation: ExperimentDecisionRecommendation;
  pairedTrials: PairedTrialDecisionScore[];
  claimOutcomes: CandidateClaimOutcomes[];
  heatmap: DecisionHeatmapRow[];
  completion: {
    completeEvaluations: number;
    expectedEvaluations: number;
    successfulFiles: number;
    failedFiles: number;
    runningFiles: number;
    totalFiles: number;
  };
}

function mean(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function completeEvaluation(evaluation: ArtifactEvaluation | undefined): evaluation is ArtifactEvaluation {
  return evaluation?.status === "passed" || evaluation?.status === "failed";
}

function pairedTrialScores(
  experiment: TomeExperiment,
  artifacts: ExperimentArtifact[],
  evaluations: ArtifactEvaluation[],
): PairedTrialDecisionScore[] {
  const rows: PairedTrialDecisionScore[] = [];
  for (let trial = 1; trial <= experiment.config.repeat_count; trial += 1) {
    const aArtifact = artifacts.find((artifact) =>
      artifact.trial === trial && artifact.candidate === "a");
    const bArtifact = artifacts.find((artifact) =>
      artifact.trial === trial && artifact.candidate === "b");
    const aEvaluation = evaluations.find((evaluation) =>
      evaluation.artifact_id === aArtifact?._id);
    const bEvaluation = evaluations.find((evaluation) =>
      evaluation.artifact_id === bArtifact?._id);
    if (!completeEvaluation(aEvaluation) || !completeEvaluation(bEvaluation)) continue;
    const a = evaluationQualityScore(aEvaluation);
    const b = evaluationQualityScore(bEvaluation);
    const delta = a - b;
    rows.push({
      trial,
      a,
      b,
      delta,
      winner: Math.abs(delta) < 1e-9 ? "tie" : delta > 0 ? "a" : "b",
    });
  }
  return rows;
}

function claimOutcomes(
  experiment: TomeExperiment,
  artifacts: ExperimentArtifact[],
  evaluations: ArtifactEvaluation[],
): CandidateClaimOutcomes[] {
  return (["a", "b"] as const).map((candidate) => {
    const artifactIds = new Set(artifacts
      .filter((artifact) => artifact.candidate === candidate)
      .map((artifact) => artifact._id));
    const claims = evaluations
      .filter((evaluation) => artifactIds.has(evaluation.artifact_id)
        && evaluation.status !== "error")
      .flatMap((evaluation) => evaluation.claims);
    const counts = Object.fromEntries(CLAIM_OUTCOME_KEYS.map((key) => [
      key,
      claims.filter((claim) => claim.classification === key).length,
    ])) as Record<ClaimOutcomeKey, number>;
    return {
      candidate,
      model: candidate === "a" ? experiment.config.model_a : experiment.config.model_b,
      counts,
      total: claims.length,
    };
  });
}

function decisionHeatmap(
  experiment: TomeExperiment,
  artifacts: ExperimentArtifact[],
  evaluations: ArtifactEvaluation[],
): DecisionHeatmapRow[] {
  const values = new Map<string, Record<ExperimentCandidate, Map<TomeRubricId, number[]>>>();
  for (const artifact of artifacts) {
    const evaluation = evaluations.find((candidate) => candidate.artifact_id === artifact._id);
    if (!evaluation || evaluation.status === "error") continue;
    for (const page of artifact.pages) {
      if (!pageIsInEvaluationScope(experiment.config, page.path)) continue;
      const view = buildPageEvaluationView(
        evaluation,
        artifact,
        page.path,
        experiment.config.rubric_policy,
      );
      if (!view) continue;
      const row = values.get(page.path) ?? {
        a: new Map<TomeRubricId, number[]>(),
        b: new Map<TomeRubricId, number[]>(),
      };
      for (const rubricId of DECISION_HEATMAP_RUBRICS) {
        const rubric = view.rubrics.find((candidate) => candidate.id === rubricId);
        const score = rubric ? rubricQualityScore(rubric) : null;
        if (score === null) continue;
        const scores = row[artifact.candidate].get(rubricId) ?? [];
        scores.push(score);
        row[artifact.candidate].set(rubricId, scores);
      }
      values.set(page.path, row);
    }
  }
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([path, row]) => ({
      path,
      cells: DECISION_HEATMAP_RUBRICS.map((rubricId) => {
        const a = mean(row.a.get(rubricId) ?? []);
        const b = mean(row.b.get(rubricId) ?? []);
        const delta = a === null || b === null ? null : a - b;
        return {
          rubricId,
          a,
          b,
          delta,
          leader: delta === null
            ? null
            : Math.abs(delta) < 0.025
              ? "tie" as const
              : delta > 0 ? "a" as const : "b" as const,
        };
      }),
    }))
    .filter((row) => row.cells.some((cell) => cell.a !== null || cell.b !== null));
}

function blockingFailureCount(
  candidate: ExperimentCandidate,
  artifacts: ExperimentArtifact[],
  evaluations: ArtifactEvaluation[],
): number {
  const artifactIds = new Set(artifacts
    .filter((artifact) => artifact.candidate === candidate)
    .map((artifact) => artifact._id));
  return evaluations.filter((evaluation) => artifactIds.has(evaluation.artifact_id))
    .reduce((count, evaluation) => count + evaluation.rubrics.filter((rubric) =>
      rubric.enabled && rubric.blocking && rubric.passed === false).length, 0);
}

function recommendation(
  experiment: TomeExperiment,
  artifacts: ExperimentArtifact[],
  evaluations: ArtifactEvaluation[],
  pairs: PairedTrialDecisionScore[],
): ExperimentDecisionRecommendation {
  const blockers: string[] = [];
  const selectedPageRun = isSelectedPageEvaluation(experiment.config);
  if (selectedPageRun) {
    blockers.push("Selected-page results cannot determine a project-wide winner.");
  }
  if (["queued", "running", "evaluating"].includes(experiment.status)) {
    blockers.push("The evaluation run is still in progress.");
  }
  const evaluatorIndependent = ![
    experiment.config.model_a,
    experiment.config.model_b,
  ].includes(experiment.config.evaluator_model);
  if (!evaluatorIndependent) blockers.push("The evaluator is also a candidate model.");
  if (pairs.length < experiment.config.repeat_count) {
    blockers.push(`${experiment.config.repeat_count - pairs.length} paired trial(s) are incomplete.`);
  }
  if (pairs.length < 3) blockers.push("At least 3 complete paired trials are required.");
  if (blockers.length > 0) {
    if (selectedPageRun) {
      return {
        candidate: null,
        title: "Scoped comparison only",
        evidenceLabel: "Selected-page result",
        reason: "Review the selected-page findings, then run an all-pages evaluation before promoting a project-wide winner.",
        blockers,
      };
    }
    const needsOnlyMoreTrials = blockers.length === 1
      && blockers[0] === "At least 3 complete paired trials are required.";
    return {
      candidate: null,
      title: "No recommendation yet",
      evidenceLabel: "Incomplete evidence",
      reason: needsOnlyMoreTrials
        ? `This run is complete. Run ${3 - pairs.length} more paired trial(s) before selecting a model.`
        : "Resolve the items below before selecting a model.",
      blockers,
    };
  }

  const aWins = pairs.filter((pair) => pair.winner === "a").length;
  const bWins = pairs.filter((pair) => pair.winner === "b").length;
  const ties = pairs.filter((pair) => pair.winner === "tie").length;
  if (aWins === bWins) {
    return {
      candidate: null,
      title: "No clear winner",
      evidenceLabel: pairs.length < 5 ? "Directional result" : "Repeated result",
      reason: `The paired trials are tied ${aWins}-${bWins} with ${ties} tie(s).`,
      blockers: ["Run more paired trials or review the file-level differences."],
    };
  }

  const candidate: ExperimentCandidate = aWins > bWins ? "a" : "b";
  const winnerName = candidate === "a" ? experiment.config.model_a : experiment.config.model_b;
  const candidateWins = candidate === "a" ? aWins : bWins;
  const candidateLosses = candidate === "a" ? bWins : aWins;
  const blockingFailures = blockingFailureCount(candidate, artifacts, evaluations);
  const deltas = pairs.map((pair) => candidate === "a" ? pair.delta : -pair.delta);
  const averageDelta = mean(deltas) ?? 0;
  if (blockingFailures > 0) {
    return {
      candidate: null,
      title: "Lead blocked by quality policy",
      evidenceLabel: "Human review required",
      reason: `${winnerName} leads ${candidateWins}-${candidateLosses}, but has ${blockingFailures} blocking rubric failure(s).`,
      blockers: ["Review the blocking findings before selecting a winner."],
    };
  }
  return {
    candidate,
    title: `${winnerName} leads`,
    evidenceLabel: pairs.length < 5 ? "Directional result" : "Repeated result",
    reason: `Won ${candidateWins} of ${pairs.length} paired trials with an average quality lead of ${(averageDelta * 100).toFixed(1)} points${ties ? ` and ${ties} tie(s)` : ""}.`,
    blockers: pairs.length < 5
      ? ["Fewer than 5 paired trials: treat this as directional, not statistically significant."]
      : [],
  };
}

export function buildExperimentDecisionView(input: {
  experiment: TomeExperiment;
  artifacts: ExperimentArtifact[];
  evaluations: ArtifactEvaluation[];
  fileEvaluations: ArtifactFileEvaluation[];
}): ExperimentDecisionView {
  const pairs = pairedTrialScores(input.experiment, input.artifacts, input.evaluations);
  const completeEvaluations = input.evaluations.filter(completeEvaluation).length;
  const scopedFileEvaluations = input.fileEvaluations.filter((file) =>
    pageIsInEvaluationScope(input.experiment.config, file.path));
  return {
    recommendation: recommendation(
      input.experiment,
      input.artifacts,
      input.evaluations,
      pairs,
    ),
    pairedTrials: pairs,
    claimOutcomes: claimOutcomes(input.experiment, input.artifacts, input.evaluations),
    heatmap: decisionHeatmap(input.experiment, input.artifacts, input.evaluations),
    completion: {
      completeEvaluations,
      expectedEvaluations: input.experiment.config.repeat_count * 2,
      successfulFiles: scopedFileEvaluations.filter((file) => file.status === "succeeded").length,
      failedFiles: scopedFileEvaluations.filter((file) => file.status === "error").length,
      runningFiles: scopedFileEvaluations.filter((file) => file.status === "running").length,
      totalFiles: scopedFileEvaluations.length,
    },
  };
}
