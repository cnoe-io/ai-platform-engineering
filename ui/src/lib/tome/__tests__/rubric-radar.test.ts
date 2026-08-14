/** @jest-environment node */

import { buildRubricRadarScores, rubricQualityScore } from "@/lib/tome/rubric-radar";
import type { RubricResult } from "@/types/tome-evaluation";

function rubric(overrides: Partial<RubricResult> & Pick<RubricResult, "id">): RubricResult {
  return {
    enabled: true,
    passed: true,
    blocking: false,
    findings: [],
    ...overrides,
  };
}

describe("rubric radar normalization", () => {
  it("keeps positive scores and inverts negative rates", () => {
    expect(rubricQualityScore(rubric({ id: "grounding", score: 0.82 }))).toBe(0.82);
    expect(rubricQualityScore(rubric({
      id: "unsupported_claims",
      rate: 0.18,
    }))).toBeCloseTo(0.82);
  });

  it("maps count-only safety findings to a consistent quality direction", () => {
    expect(rubricQualityScore(rubric({ id: "fabricated_entities", count: 0 }))).toBe(1);
    expect(rubricQualityScore(rubric({
      id: "fabricated_entities",
      count: 1,
      passed: false,
    }))).toBe(0);
  });

  it("ignores disabled rubrics and clamps evaluator output", () => {
    expect(rubricQualityScore(rubric({
      id: "grounding",
      enabled: false,
      passed: null,
      score: 0.9,
    }))).toBeNull();
    expect(rubricQualityScore(rubric({ id: "grounding", score: 1.2 }))).toBe(1);
  });

  it("groups the quality rubrics without treating cost as quality", () => {
    const scores = buildRubricRadarScores([
      rubric({ id: "citation_coverage", rate: 0.8 }),
      rubric({ id: "citation_correctness", rate: 0.6 }),
      rubric({ id: "unsupported_claims", rate: 0.1 }),
      rubric({ id: "cost_efficiency", score: 42 }),
    ]);

    expect(scores.find((score) => score.id === "citations")?.score).toBeCloseTo(0.7);
    expect(scores.find((score) => score.id === "safety")?.score).toBeCloseTo(0.9);
    expect(scores.some((score) => score.id === "cost_efficiency")).toBe(false);
  });
});
