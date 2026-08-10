/**
 * Build the user-facing message shown when a blocking AI Review gates a
 * Next/Save action. The message names the grade the admin requires (derived
 * from `min_score`) and, when available, the grade the content actually
 * scored — so the user knows the bar and how far off they are.
 */

import { scoreToGrade } from "@/lib/server/ai-review/grading";
import type { ReviewConfig, ReviewResult } from "@/types/ai-review";

/**
 * @param where  Human phrase for where to act, e.g. "the Instructions step".
 * @param action What the gate is blocking, e.g. "saving" or "continuing".
 */
export function buildBlockingMessage(
  config: ReviewConfig | null,
  result: ReviewResult | null,
  where: string,
  action: string,
): string {
  const fix = `Address the comments in ${where} before ${action}.`;
  if (!config) return `AI Review failed — ${fix}`;

  const requiredGrade = scoreToGrade(config.min_score, config.grade_thresholds);
  const required = `AI Review requires at least grade ${requiredGrade} (set by your admin)`;

  if (!result) return `${required}. ${fix}`;

  const scored = `${result.grade} (${Math.round(result.score * 100)}%)`;
  return `${required}, but this scored ${scored}. ${fix}`;
}
