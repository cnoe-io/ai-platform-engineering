/** @jest-environment node */

import { defaultRubricPolicy } from "@/lib/tome/evaluation-store";
import { buildPageEvaluationView } from "@/lib/tome/page-evaluation";
import type {
  ArtifactEvaluation,
  ClaimFinding,
  ExperimentArtifact,
} from "@/types/tome-evaluation";

const artifact = {
  _id: "artifact-a",
  experiment_id: "experiment",
  project_id: "project",
  trial: 1,
  candidate: "a",
  blind_label: "candidate-x",
  model: "provider/model-alpha",
  run_identity: "run",
  evidence_bundle_id: "bundle",
  pages: [
    { path: "activity.md", markdown: "Supported fact", content_hash: "a", written_at: "2026-01-01T00:00:00.000Z" },
    { path: "foo.md", markdown: "Bad claim", content_hash: "b", written_at: "2026-01-01T00:00:00.000Z" },
  ],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} satisfies ExperimentArtifact;

function claim(overrides: Partial<ClaimFinding> & Pick<ClaimFinding, "id" | "page" | "exact_text" | "classification">): ClaimFinding {
  return {
    section: null,
    start_offset: 0,
    end_offset: overrides.exact_text.length,
    reason: "Example finding",
    confidence: 0.9,
    abstained: false,
    citations: ["https://example.test/source"],
    evidence: [{
      evidence_item_id: "evidence",
      canonical_uri: "https://example.test/source",
      content_hash: "hash",
    }],
    ...overrides,
  };
}

const evaluation = {
  _id: "evaluation",
  experiment_id: "experiment",
  artifact_id: artifact._id,
  blind_label: artifact.blind_label,
  evaluator_model: "provider/model-judge",
  evaluator_is_candidate: false,
  status: "failed",
  claims: [
    claim({ id: "supported", page: "activity.md", exact_text: "Supported fact", classification: "supported" }),
    claim({ id: "contradicted", page: "foo.md", exact_text: "Bad claim", classification: "contradicted" }),
  ],
  rubrics: [],
  blocking_findings: [],
  created_at: "2026-01-01T00:00:00.000Z",
} satisfies ArtifactEvaluation;

describe("selected-page evaluation view", () => {
  it("recalculates stats and rubrics for the selected file", () => {
    const policy = defaultRubricPolicy();
    const activity = buildPageEvaluationView(evaluation, artifact, "activity.md", policy);
    const foo = buildPageEvaluationView(evaluation, artifact, "foo.md", policy);

    expect(activity?.stats).toMatchObject({ claimCount: 1, supported: 1, contradicted: 0, supportRate: 1 });
    expect(foo?.stats).toMatchObject({ claimCount: 1, supported: 0, contradicted: 1, supportRate: 0 });
    expect(activity?.rubrics.find((rubric) => rubric.id === "grounding")?.score).toBe(1);
    expect(foo?.rubrics.find((rubric) => rubric.id === "grounding")?.score).toBe(0);
    expect(foo?.rubrics.find((rubric) => rubric.id === "contradictions")?.rate).toBe(1);
  });
});
