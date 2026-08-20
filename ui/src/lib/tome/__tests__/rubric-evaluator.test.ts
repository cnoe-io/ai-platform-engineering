import {
  aggregateExperiment,
  canAutoPromoteOverdue,
  calculateRubrics,
  qualityGateDecision,
} from "@/lib/tome/rubric-evaluator";
import {
  defaultRubricPolicy,
  fallbackQualityPolicy,
} from "@/lib/tome/evaluation-store";
import type {
  ArtifactEvaluation,
  ClaimFinding,
  ExperimentArtifact,
  TomeExperiment,
} from "@/types/tome-evaluation";

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

function claim(
  id: string,
  classification: ClaimFinding["classification"],
  overrides: Partial<ClaimFinding> = {},
): ClaimFinding {
  return {
    id,
    page: "overview.md",
    section: "Status",
    exact_text: `Claim ${id}`,
    start_offset: 0,
    end_offset: 7,
    classification,
    reason: "fixture",
    confidence: 0.9,
    abstained: false,
    citations: ["https://example.test/issues/1"],
    evidence: [{
      evidence_item_id: `evidence-${id}`,
      canonical_uri: "github://example.test/org/repo/issues/1",
      content_hash: id.padEnd(64, "0").slice(0, 64),
    }],
    ...overrides,
  };
}

describe("TOME grounded rubric calculations", () => {
  it("exposes the grounding denominator and weighted component counts", () => {
    const results = calculateRubrics(defaultRubricPolicy(), {
      claims: [
        claim("supported", "supported"),
        claim("partial", "partially_supported"),
        claim("unsupported", "unsupported", { citations: [], evidence: [] }),
        claim("unknown", "unverifiable", { citations: [], evidence: [] }),
      ],
      candidatePages: {
        "overview.md": "---\nkind: dynamic\n---\n# Overview\n",
      },
      evidencePagePaths: ["overview.md"],
      requiredTemplatePaths: ["overview.md"],
      signals: {
        explicit_gaps: { passed: 1, total: 1 },
        semantic_fidelity: { passed: 1, total: 1 },
        conflict_disclosure: { passed: 1, total: 1 },
        source_freshness: { passed: 1, total: 1 },
        material_coverage: { passed: 1, total: 1 },
        scope_fidelity: { passed: 1, total: 1 },
      },
    });

    const grounding = results.find((result) => result.id === "grounding");
    expect(grounding).toMatchObject({
      score: 0.375,
      numerator: 1.5,
      denominator: 4,
      passed: false,
    });
    expect(results).toHaveLength(25);
  });

  it("reports critical fabrications separately and lets each rubric be disabled", () => {
    const policy = defaultRubricPolicy();
    policy.citation_specificity.enabled = false;
    const results = calculateRubrics(policy, {
      claims: [claim("partner", "unsupported", {
        critical_kind: "partner_or_customer",
        fabricated_entities: ["Example Partner"],
      })],
      candidatePages: {},
      evidencePagePaths: [],
      requiredTemplatePaths: [],
    });

    expect(results.find((result) => result.id === "unsupported_critical_claims"))
      .toMatchObject({ count: 1, passed: false, blocking: true });
    expect(results.find((result) => result.id === "fabricated_entities"))
      .toMatchObject({ count: 1, passed: false });
    expect(results.find((result) => result.id === "citation_specificity"))
      .toMatchObject({ enabled: false, passed: null });
  });

  it("rejects evaluator evidence references that are not in the frozen bundle", () => {
    const results = calculateRubrics(defaultRubricPolicy(), {
      claims: [claim("unsupported-reference", "supported")],
      candidatePages: {},
      evidencePagePaths: [],
      evidenceItems: [{
        id: "different-evidence",
        canonical_uri: "github://example.test/org/repo/issues/2",
        content_hash: "2".repeat(64),
      }],
      requiredTemplatePaths: [],
    });

    expect(results.find((result) => result.id === "claim_evidence")).toMatchObject({
      score: 0,
      passed: false,
    });
    expect(results.find((result) => result.id === "citation_coverage")).toMatchObject({
      rate: 0,
      passed: false,
    });
  });

  it("fails the atomic inventory when an exact-text span does not resolve", () => {
    const results = calculateRubrics(defaultRubricPolicy(), {
      claims: [claim("bad-span", "supported")],
      candidatePages: { "overview.md": "No matching claim is present." },
      evidencePagePaths: [],
      requiredTemplatePaths: [],
    });

    expect(results.find((result) => result.id === "atomic_claim_inventory")).toMatchObject({
      score: 0,
      passed: false,
    });
  });

  it("applies contradiction count and rate thresholds independently", () => {
    const policy = defaultRubricPolicy();
    policy.contradictions = {
      enabled: true,
      blocking: true,
      max_count: 10,
      max_rate: 0.1,
    };
    const candidate = "Claim one\nClaim two\n";
    const results = calculateRubrics(policy, {
      claims: [
        claim("one", "contradicted", { exact_text: "Claim one", end_offset: 9 }),
        claim("two", "supported", { exact_text: "Claim two", start_offset: 10, end_offset: 19 }),
      ],
      candidatePages: { "overview.md": candidate },
      evidencePagePaths: [],
      requiredTemplatePaths: [],
    });

    expect(results.find((result) => result.id === "contradictions")).toMatchObject({
      count: 1,
      rate: 0.5,
      passed: false,
    });
  });
});

describe("TOME promotion gate", () => {
  it("fails closed on missing evaluation in enforce mode", () => {
    const policy = { ...fallbackQualityPolicy(), mode: "enforce" as const, version: 3 };
    expect(qualityGateDecision(policy, null)).toEqual({
      allowed: false,
      mode: "enforce",
      policy_version: 3,
      blockers: ["Evaluation is missing."],
      requires_override: true,
    });
  });

  it("keeps findings observable without blocking in observe mode", () => {
    const policy = { ...fallbackQualityPolicy(), mode: "observe" as const };
    const evaluation = {
      status: "failed",
      rubrics: [{
        id: "grounding",
        enabled: true,
        passed: false,
        blocking: true,
        findings: [],
      }],
      blocking_findings: ["Unsupported deadline"],
    } as ArtifactEvaluation;
    expect(qualityGateDecision(policy, evaluation)).toMatchObject({
      allowed: true,
      blockers: ["grounding", "Unsupported deadline"],
    });
  });

  it("fails closed when an artifact evaluation is only partial", () => {
    const policy = { ...fallbackQualityPolicy(), mode: "enforce" as const };
    const evaluation = {
      status: "partial",
      error: "One file failed; successful file results were preserved.",
      rubrics: [],
      blocking_findings: [],
    } as unknown as ArtifactEvaluation;
    expect(qualityGateDecision(policy, evaluation)).toMatchObject({
      allowed: false,
      blockers: ["One file failed; successful file results were preserved."],
      requires_override: true,
    });
  });

  it("does not auto-promote an enforced overdue draft when review or a passing gate is required", () => {
    const policy = { ...fallbackQualityPolicy(), mode: "enforce" as const };
    expect(canAutoPromoteOverdue(policy, null)).toBe(false);

    const passing = {
      status: "passed",
      rubrics: [],
      blocking_findings: [],
    } as ArtifactEvaluation;
    expect(canAutoPromoteOverdue(policy, passing)).toBe(false);
    expect(canAutoPromoteOverdue({ ...policy, require_human_review: false }, passing)).toBe(true);
    expect(canAutoPromoteOverdue({ ...policy, mode: "observe" }, passing)).toBe(false);
    expect(canAutoPromoteOverdue({
      ...policy,
      mode: "observe",
      require_human_review: false,
    }, passing)).toBe(true);
  });
});

describe("TOME experiment aggregation", () => {
  it("computes paired win/loss and score dispersion", () => {
    const experiment = {
      _id: "experiment-1",
      trials: [
        { candidate: "a", cost_usd: 1, generation_latency_ms: 10 },
        { candidate: "b", cost_usd: 2, generation_latency_ms: 20 },
      ],
    } as TomeExperiment;
    const artifacts = [
      { _id: "artifact-a", trial: 1, candidate: "a" },
      { _id: "artifact-b", trial: 1, candidate: "b" },
    ] as ExperimentArtifact[];
    const evaluation = (artifactId: string, score: number): ArtifactEvaluation => ({
      _id: `evaluation-${artifactId}`,
      experiment_id: "experiment-1",
      artifact_id: artifactId,
      blind_label: "candidate-x",
      evaluator_model: "evaluator",
      evaluator_is_candidate: false,
      status: "passed",
      claims: [claim(artifactId, "supported")],
      rubrics: [{
        id: "grounding",
        enabled: true,
        passed: true,
        blocking: true,
        score,
        findings: [],
      }],
      blocking_findings: [],
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const [a, b] = aggregateExperiment(experiment, artifacts, [
      evaluation("artifact-a", 0.9),
      evaluation("artifact-b", 0.7),
    ]);

    expect(a).toMatchObject({ wins: 1, ties: 0, losses: 0, mean_score: 0.9 });
    expect(b).toMatchObject({ wins: 0, ties: 0, losses: 1, mean_score: 0.7 });
  });

  it("excludes evaluator errors from quality scores while retaining recorded cost and latency", () => {
    const experiment = {
      _id: "experiment-errors",
      trials: [
        { candidate: "a", cost_usd: 1, generation_latency_ms: 10 },
        { candidate: "b", cost_usd: 2, generation_latency_ms: 20 },
      ],
    } as TomeExperiment;
    const artifacts = [
      { _id: "artifact-a", trial: 1, candidate: "a" },
      { _id: "artifact-b", trial: 1, candidate: "b" },
    ] as ExperimentArtifact[];
    const evaluation = (
      artifactId: string,
      status: ArtifactEvaluation["status"],
      score: number,
    ): ArtifactEvaluation => ({
      _id: `evaluation-${artifactId}`,
      experiment_id: "experiment-errors",
      artifact_id: artifactId,
      blind_label: "candidate-x",
      evaluator_model: "evaluator",
      evaluator_is_candidate: false,
      status,
      claims: [],
      rubrics: [{
        id: "grounding",
        enabled: true,
        passed: status === "passed",
        blocking: true,
        score,
        findings: [],
      }],
      blocking_findings: status === "error" ? ["Judge request failed"] : [],
      evaluation_cost_usd: status === "error" ? 0.4 : 0.2,
      evaluation_latency_ms: status === "error" ? 50 : 30,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const [a, b] = aggregateExperiment(experiment, artifacts, [
      evaluation("artifact-a", "error", 0.99),
      evaluation("artifact-b", "passed", 0.7),
    ]);

    expect(a).toMatchObject({
      wins: 0,
      ties: 0,
      losses: 0,
      pass_rate: null,
      mean_score: null,
      median_score: null,
      evaluation_cost_usd: 0.4,
      median_evaluation_latency_ms: 50,
    });
    expect(a.absolute_scores).toEqual({});
    expect(b).toMatchObject({ wins: 0, ties: 0, losses: 0, mean_score: 0.7 });

    const [partial] = aggregateExperiment(experiment, artifacts, [
      evaluation("artifact-a", "partial", 0.95),
      evaluation("artifact-b", "passed", 0.7),
    ]);
    expect(partial).toMatchObject({
      wins: 0,
      ties: 0,
      losses: 0,
      pass_rate: null,
      mean_score: null,
      evaluation_cost_usd: 0.2,
    });
  });
});
