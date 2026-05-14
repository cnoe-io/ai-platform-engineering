/**
 * Tests for computeScoreAndGrade.
 *
 * Threshold-bucket logic is just data — not tested here. These tests cover
 * the three behaviors that aren't obvious from reading the function:
 *   - empty / zero-weight rubrics don't divide by zero (treated as 1.0)
 *   - errored verdicts count toward the denominator (an LLM glitch lowers
 *     the score the same way a real fail would)
 *   - weights actually weigh — heavier passes outvote lighter fails
 */

import { computeScoreAndGrade } from "../grading";
import {
  DEFAULT_GRADE_THRESHOLDS,
  type CriterionVerdict,
} from "@/types/ai-review";

function v(
  pass: boolean,
  weight = 1,
  error: string | null = null,
): CriterionVerdict {
  return {
    id: "x",
    name: "x",
    severity: "warning",
    weight,
    pass,
    comment: "",
    anchor: null,
    suggested_fix: null,
    error,
  };
}

describe("computeScoreAndGrade", () => {
  it("treats empty and zero-weight rubrics as a passing 1.0 (no divide by zero)", () => {
    const empty = computeScoreAndGrade([], DEFAULT_GRADE_THRESHOLDS);
    expect(empty.score).toBe(1);
    expect(empty.grade).toBe("A");

    // All zero-weight criteria collapse to the same case — denominator is 0.
    const allZeroWeight = computeScoreAndGrade(
      [v(false, 0), v(true, 0)],
      DEFAULT_GRADE_THRESHOLDS,
    );
    expect(allZeroWeight.score).toBe(1);
  });

  it("counts errored verdicts toward the denominator but not the numerator", () => {
    // 1 pass + 1 errored fail = 1/2 — the LLM glitch lowers the score.
    const result = computeScoreAndGrade(
      [v(true), v(false, 1, "boom")],
      DEFAULT_GRADE_THRESHOLDS,
    );
    expect(result.score).toBeCloseTo(0.5, 5);
    expect(result.passed_count).toBe(1);
    expect(result.total).toBe(2);
  });

  it("weights are applied — a heavy pass outweighs a light fail", () => {
    // weight 4 pass + weight 1 fail = 4/5 = 0.8
    const result = computeScoreAndGrade(
      [v(true, 4), v(false, 1)],
      DEFAULT_GRADE_THRESHOLDS,
    );
    expect(result.score).toBeCloseTo(0.8, 5);
    // passed_count counts criteria, not weight — 1 of 2 criteria passed.
    expect(result.passed_count).toBe(1);
  });
});
