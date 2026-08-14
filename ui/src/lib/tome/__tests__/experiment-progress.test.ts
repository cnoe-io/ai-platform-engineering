/** @jest-environment node */

import { buildExperimentProgress } from "@/lib/tome/experiment-progress";
import type {
  ExperimentArtifact,
  ExperimentStatus,
  ExperimentTrial,
} from "@/types/tome-evaluation";

function trial(overrides: Partial<ExperimentTrial> & Pick<ExperimentTrial, "candidate" | "status">): ExperimentTrial {
  return {
    trial: 1,
    run_identity: `run-${overrides.candidate}`,
    artifact_id: `artifact-${overrides.candidate}`,
    model: `provider/model-${overrides.candidate}`,
    ...overrides,
  };
}

function artifact(candidate: "a" | "b", blindLabel: string): ExperimentArtifact {
  return {
    _id: `artifact-${candidate}`,
    experiment_id: "experiment",
    project_id: "project",
    trial: 1,
    candidate,
    blind_label: blindLabel,
    model: `provider/model-${candidate}`,
    run_identity: `run-${candidate}`,
    evidence_bundle_id: "bundle",
    pages: [
      { path: "activity.md", markdown: "Body", content_hash: "hash", written_at: "2026-01-01T00:00:00.000Z" },
      { path: "foo.md", markdown: "Body", content_hash: "hash", written_at: "2026-01-01T00:00:00.000Z" },
    ],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function experiment(status: ExperimentStatus, trials: ExperimentTrial[]) {
  return {
    status,
    trials,
    config: { repeat_count: 1, evaluator_model: "provider/model-judge" },
  };
}

describe("experiment progress", () => {
  it("shows the active generation model and artifact pages", () => {
    const trials = [
      trial({ candidate: "a", status: "succeeded" }),
      trial({ candidate: "b", status: "running" }),
    ];

    expect(buildExperimentProgress(
      experiment("running", trials),
      [artifact("a", "candidate-y"), artifact("b", "candidate-x")],
      [],
    )).toMatchObject({
      completedSteps: 1,
      totalSteps: 4,
      percent: 25,
      title: "Generating candidate output",
      trial: 1,
      model: "provider/model-b",
      pages: ["activity.md", "foo.md"],
    });
  });

  it("shows the next unevaluated artifact in blind-label order", () => {
    const trials = [
      trial({ candidate: "a", status: "succeeded" }),
      trial({ candidate: "b", status: "succeeded" }),
    ];
    const artifacts = [artifact("a", "candidate-y"), artifact("b", "candidate-x")];

    expect(buildExperimentProgress(
      experiment("evaluating", trials),
      artifacts,
      [{ artifact_id: "artifact-b" }],
    )).toMatchObject({
      completedSteps: 3,
      totalSteps: 4,
      percent: 75,
      title: "Evaluating candidate output",
      trial: 1,
      model: "provider/model-a",
      evaluatorModel: "provider/model-judge",
      pages: ["activity.md", "foo.md"],
    });
  });

  it("counts a failed generation and its skipped judge step as finished work", () => {
    const progress = buildExperimentProgress(
      experiment("evaluating", [
        trial({ candidate: "a", status: "failed" }),
        trial({ candidate: "b", status: "succeeded" }),
      ]),
      [artifact("a", "candidate-x"), artifact("b", "candidate-y")],
      [],
    );

    expect(progress).toMatchObject({ completedSteps: 3, totalSteps: 4, percent: 75 });
  });

  it("reports completed experiments at 100 percent", () => {
    const progress = buildExperimentProgress(
      experiment("completed", [
        trial({ candidate: "a", status: "succeeded" }),
        trial({ candidate: "b", status: "succeeded" }),
      ]),
      [],
      [],
    );

    expect(progress).toMatchObject({
      completedSteps: 4,
      totalSteps: 4,
      percent: 100,
      title: "Evaluation completed",
      active: false,
    });
  });
});
