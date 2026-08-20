import { buildExperimentDecisionView } from "@/lib/tome/experiment-decision";
import { defaultRubricPolicy } from "@/lib/tome/evaluation-store";
import type {
  ArtifactEvaluation,
  ArtifactFileEvaluation,
  ClaimFinding,
  ExperimentArtifact,
  ExperimentCandidate,
  TomeExperiment,
} from "@/types/tome-evaluation";

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

const CREATED_AT = "2026-01-01T00:00:00.000Z";
const PAGE_PATH = "overview.md";

function experiment(overrides: Partial<TomeExperiment> = {}): TomeExperiment {
  return {
    _id: "experiment-1",
    project_id: "project-1",
    project_slug: "example",
    evidence_bundle_id: "bundle-1",
    evidence_hash: "1".repeat(64),
    config: {
      evaluation_suite_id: "example-suite",
      evaluation_suite_version: 1,
      model_a: "provider/model-a",
      model_b: "provider/model-b",
      evaluator_model: "provider/upper-bound-model",
      operation: "ingest",
      entity_type: "project",
      entity_id: "project-1",
      repeat_count: 3,
      cost_ceiling_usd: 10,
      promotion_mode: "manual",
      rubric_policy: defaultRubricPolicy(),
      rubric_policy_version: 1,
      rubric_policy_scope: "global",
      rubric_policy_scope_id: null,
      quality_policy_mode: "enforce",
      require_human_review: true,
      allow_steward_override: false,
      prompt_hash: "2".repeat(64),
      tool_contract_version: "v1",
      template_versions: {},
      turn_limit: 100,
      seed: 1,
    },
    config_version: 1,
    status: "completed",
    trials: [],
    created_at: CREATED_AT,
    created_by: "test-user",
    ...overrides,
  };
}

function artifact(trial: number, candidate: ExperimentCandidate): ExperimentArtifact {
  const id = `artifact-${candidate}-${trial}`;
  return {
    _id: id,
    experiment_id: "experiment-1",
    project_id: "project-1",
    trial,
    candidate,
    blind_label: `candidate-${candidate}`,
    model: `provider/model-${candidate}`,
    run_identity: `run-${candidate}-${trial}`,
    evidence_bundle_id: "bundle-1",
    pages: [{
      path: PAGE_PATH,
      markdown: "A grounded project status statement.",
      content_hash: `${candidate}${trial}`.padEnd(64, "0"),
      written_at: CREATED_AT,
    }],
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

function claim(
  id: string,
  classification: ClaimFinding["classification"],
): ClaimFinding {
  return {
    id,
    page: PAGE_PATH,
    section: "Status",
    exact_text: "A grounded project status statement.",
    start_offset: 0,
    end_offset: 36,
    classification,
    reason: "fixture",
    confidence: 0.9,
    abstained: false,
    citations: classification === "supported" ? ["https://example.test/source/1"] : [],
    evidence: classification === "supported" ? [{
      evidence_item_id: `evidence-${id}`,
      canonical_uri: "https://example.test/source/1",
      content_hash: "3".repeat(64),
    }] : [],
  };
}

function evaluation(
  trial: number,
  candidate: ExperimentCandidate,
  score: number,
  overrides: Partial<ArtifactEvaluation> = {},
): ArtifactEvaluation {
  const artifactId = `artifact-${candidate}-${trial}`;
  return {
    _id: `evaluation-${candidate}-${trial}`,
    experiment_id: "experiment-1",
    artifact_id: artifactId,
    blind_label: `candidate-${candidate}`,
    evaluator_model: "provider/upper-bound-model",
    evaluator_is_candidate: false,
    status: "passed",
    claims: [claim(`${candidate}-${trial}`, candidate === "a" ? "supported" : "unsupported")],
    rubrics: [{
      id: "grounding",
      enabled: true,
      passed: true,
      blocking: true,
      score,
      findings: [],
    }],
    blocking_findings: [],
    created_at: CREATED_AT,
    ...overrides,
  };
}

function fileCheckpoint(
  trial: number,
  candidate: ExperimentCandidate,
  status: ArtifactFileEvaluation["status"],
): ArtifactFileEvaluation {
  return {
    _id: `file-${candidate}-${trial}`,
    experiment_id: "experiment-1",
    artifact_id: `artifact-${candidate}-${trial}`,
    blind_label: `candidate-${candidate}`,
    path: PAGE_PATH,
    content_hash: "4".repeat(64),
    status,
    claims: [],
    signals: {},
    chunk_count: 1,
    completed_chunks: status === "succeeded" ? 1 : 0,
    attempts: 1,
    started_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

describe("TOME experiment decision dashboard", () => {
  const artifacts = ([1, 2, 3] as const).flatMap((trial) => [
    artifact(trial, "a"),
    artifact(trial, "b"),
  ]);
  const evaluations = ([1, 2, 3] as const).flatMap((trial) => [
    evaluation(trial, "a", 0.85),
    evaluation(trial, "b", 0.65),
  ]);

  it("recommends a consistent paired-trial leader and exposes admin drilldowns", () => {
    const view = buildExperimentDecisionView({
      experiment: experiment(),
      artifacts,
      evaluations,
      fileEvaluations: ([1, 2, 3] as const).flatMap((trial) => [
        fileCheckpoint(trial, "a", "succeeded"),
        fileCheckpoint(trial, "b", "succeeded"),
      ]),
    });

    expect(view.recommendation).toMatchObject({
      candidate: "a",
      title: "provider/model-a leads",
      evidenceLabel: "Directional result",
    });
    expect(view.pairedTrials).toHaveLength(3);
    expect(view.pairedTrials.every((pair) => pair.winner === "a")).toBe(true);
    expect(view.claimOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidate: "a", counts: expect.objectContaining({ supported: 3 }) }),
      expect.objectContaining({ candidate: "b", counts: expect.objectContaining({ unsupported: 3 }) }),
    ]));
    expect(view.heatmap).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: PAGE_PATH }),
    ]));
    expect(view.completion).toMatchObject({
      completeEvaluations: 6,
      expectedEvaluations: 6,
      successfulFiles: 6,
      failedFiles: 0,
    });
  });

  it("withholds a recommendation while the run or paired evidence is incomplete", () => {
    const view = buildExperimentDecisionView({
      experiment: experiment({ status: "evaluating" }),
      artifacts,
      evaluations: evaluations.slice(0, 4),
      fileEvaluations: [fileCheckpoint(1, "a", "succeeded"), fileCheckpoint(1, "b", "error")],
    });

    expect(view.recommendation.candidate).toBeNull();
    expect(view.recommendation.blockers).toEqual(expect.arrayContaining([
      "The evaluation run is still in progress.",
      "1 paired trial(s) are incomplete.",
      "At least 3 complete paired trials are required.",
    ]));
    expect(view.completion).toMatchObject({ failedFiles: 1, successfulFiles: 1 });
  });

  it("keeps selected-page results scoped and blocks project-wide promotion", () => {
    const baseExperiment = experiment();
    const view = buildExperimentDecisionView({
      experiment: experiment({
        config: {
          ...baseExperiment.config,
          evaluation_page_scope: { mode: "selected", paths: [PAGE_PATH] },
        },
      }),
      artifacts,
      evaluations,
      fileEvaluations: ([1, 2, 3] as const).flatMap((trial) => [
        fileCheckpoint(trial, "a", "succeeded"),
        fileCheckpoint(trial, "b", "succeeded"),
      ]),
    });

    expect(view.recommendation).toMatchObject({
      candidate: null,
      title: "Scoped comparison only",
      evidenceLabel: "Selected-page result",
    });
    expect(view.recommendation.blockers).toContain(
      "Selected-page results cannot determine a project-wide winner.",
    );
    expect(view.heatmap).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: PAGE_PATH }),
    ]));
  });

  it("explains that a completed one-trial run needs more paired trials", () => {
    const baseExperiment = experiment();
    const view = buildExperimentDecisionView({
      experiment: experiment({
        config: { ...baseExperiment.config, repeat_count: 1 },
      }),
      artifacts: artifacts.slice(0, 2),
      evaluations: evaluations.slice(0, 2),
      fileEvaluations: [
        fileCheckpoint(1, "a", "succeeded"),
        fileCheckpoint(1, "b", "succeeded"),
      ],
    });

    expect(view.recommendation).toMatchObject({
      candidate: null,
      title: "No recommendation yet",
      reason: "This run is complete. Run 2 more paired trial(s) before selecting a model.",
      blockers: ["At least 3 complete paired trials are required."],
    });
  });

  it("blocks a quality leader that fails an enabled blocking rubric", () => {
    const failedWinner = evaluations.map((item) => item.artifact_id === "artifact-a-1"
      ? {
          ...item,
          status: "failed" as const,
          rubrics: [{
            ...item.rubrics[0],
            passed: false,
            blocking: true,
          }],
        }
      : item);
    const view = buildExperimentDecisionView({
      experiment: experiment(),
      artifacts,
      evaluations: failedWinner,
      fileEvaluations: [],
    });

    expect(view.recommendation).toMatchObject({
      candidate: null,
      title: "Lead blocked by quality policy",
      evidenceLabel: "Human review required",
    });
  });

  it("requires an evaluator outside the candidate pair", () => {
    const base = experiment();
    const view = buildExperimentDecisionView({
      experiment: experiment({
        config: { ...base.config, evaluator_model: base.config.model_a },
      }),
      artifacts,
      evaluations,
      fileEvaluations: [],
    });

    expect(view.recommendation.candidate).toBeNull();
    expect(view.recommendation.blockers).toContain("The evaluator is also a candidate model.");
  });
});
