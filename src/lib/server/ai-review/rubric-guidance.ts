/**
 * rubric-guidance — turn the live AI Review rubric into a guidance block that
 * can be appended to an AI Assist system prompt.
 *
 * AI Assist generates content (agent system prompts, SKILL.md) that AI Review
 * then grades. Feeding the same criteria the reviewer uses into the generator
 * lets the output clear the pass bar on the first attempt, including any
 * criteria an admin has added or reworded — the two stay in lockstep because
 * both read `review_configs`.
 */

import type { ReviewConfig, ReviewCriterion } from "@/types/ai-review";

/** Higher-severity criteria carry more weight in the grade, so surface them
 * first and label them so the model prioritizes the ones that matter most. */
const SEVERITY_LABEL: Record<ReviewCriterion["severity"], string> = {
  error: "must",
  warning: "should",
  info: "nice-to-have",
};

const SEVERITY_RANK: Record<ReviewCriterion["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Render the config's criteria into a directive block. Criteria are ordered by
 * severity then weight so the model reads the highest-impact checks first. The
 * `micro_prompt` is the exact yes/no question the grader will ask, so passing
 * it through verbatim keeps the generator aligned with the grader.
 */
export function buildRubricGuidance(config: ReviewConfig): string {
  const ordered = [...config.criteria].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return sev !== 0 ? sev : b.weight - a.weight;
  });
  const bullets = ordered
    .map(
      (c) =>
        `- [${SEVERITY_LABEL[c.severity]}] (weight ${c.weight}) ${c.name}: ${c.micro_prompt.trim()}`,
    )
    .join("\n");
  return `Your output is scored against the rubric below before it is accepted. Each line is a pass/fail check applied to YOUR output; "weight" is how much it moves the score. To be accepted you must pass enough weight — so satisfy EVERY "must" check and as many "should"/"nice-to-have" checks as possible. Do not omit a check just to stay brief: prefer a longer, complete output over a short one that fails checks. If a check does not apply, address it explicitly (e.g. state the agent has no tools) rather than skipping it.

${bullets}`;
}

/**
 * Load the live rubric for `target` and render it as guidance. Returns null
 * when the target has no rubric or the rubric is disabled, so callers can
 * leave the base system prompt untouched.
 */
export async function loadRubricGuidance(
  target: string,
): Promise<string | null> {
  // Imported lazily so the pure renderer above stays free of the Mongo client
  // (`defaults.ts` → `mongodb`), keeping it importable in plain unit tests.
  const { ensureConfig } = await import("./defaults");
  const config = await ensureConfig(target);
  if (!config || !config.enabled || config.criteria.length === 0) return null;
  return buildRubricGuidance(config);
}
