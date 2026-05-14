/**
 * Aggregate per-criterion verdicts into an overall score + letter grade.
 *
 * Score = sum(weight * pass) / sum(weight). When all weights are zero,
 * score is treated as 1 (no division by zero, no signal of failure).
 *
 * A criterion with `error !== null` is counted as `pass=false` for both
 * numerator (zero weight contribution) and denominator (full weight) —
 * an LLM glitch lowers the score the same way a real fail would. The
 * route layer is responsible for surfacing the `error` field so the user
 * can re-run; the grader stays simple and deterministic.
 *
 * Grades bucket the score by `thresholds`: score ≥ A → A, ≥ B → B, etc.
 * Anything below D is F. Thresholds must be in [0, 1] and ordered
 * A ≥ B ≥ C ≥ D — admin UI enforces ordering; this helper does not.
 */

import type {
  CriterionVerdict,
  GradeThresholds,
  ReviewGrade,
} from "@/types/ai-review";

export interface ScoreAndGrade {
  score: number;
  grade: ReviewGrade;
  passed_count: number;
  total: number;
}

export function computeScoreAndGrade(
  verdicts: CriterionVerdict[],
  thresholds: GradeThresholds,
): ScoreAndGrade {
  let weightSum = 0;
  let passWeight = 0;
  let passedCount = 0;

  for (const v of verdicts) {
    const w = Number.isFinite(v.weight) && v.weight > 0 ? v.weight : 0;
    weightSum += w;
    if (v.pass) {
      passWeight += w;
      passedCount += 1;
    }
  }

  // No criteria, or all weights are zero — treat as passing (score 1).
  // Alternative would be 0, but that punishes admins for an empty rubric
  // and produces a misleading F grade in the UI.
  const score = weightSum === 0 ? 1 : passWeight / weightSum;

  const grade: ReviewGrade =
    score >= thresholds.A
      ? "A"
      : score >= thresholds.B
        ? "B"
        : score >= thresholds.C
          ? "C"
          : score >= thresholds.D
            ? "D"
            : "F";

  return {
    score,
    grade,
    passed_count: passedCount,
    total: verdicts.length,
  };
}
