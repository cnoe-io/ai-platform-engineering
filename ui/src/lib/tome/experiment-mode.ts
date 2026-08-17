import type {
  ExperimentConfig,
  ExperimentEvaluationMode,
  RubricPolicy,
  TomeRubricId,
} from "@/types/tome-evaluation";

export const QUICK_MAX_CLAIMS = 4;
export const QUICK_REPEAT_COUNT = 1;
export const QUICK_TURN_LIMIT = 30;
export const QUICK_COST_CEILING_USD = 3;
export const QUICK_REQUEST_TIMEOUT_MS = 90_000;
// Two bounded judge reservations still fit inside the locked $3 quick-run
// ceiling after typical candidate generation, while $0.50 was too low for a
// schema-constrained response on an ordinary architecture page.
export const QUICK_EVALUATION_CALL_BUDGET_USD = 0.75;
export const QUICK_CANDIDATE_CALL_BUDGET_USD = 0.75;

export const QUICK_RUBRICS = new Set<TomeRubricId>([
  "atomic_claim_inventory",
  "claim_evidence",
  "grounding",
  "contradictions",
  "unsupported_critical_claims",
  "fabricated_entities",
  "fabricated_quantitative_details",
  "stable_page_preservation",
  "template_compliance",
  "internal_link_validity",
  "evaluator_confidence",
]);

export function experimentEvaluationMode(config: ExperimentConfig): ExperimentEvaluationMode {
  if (config.evaluation_mode) return config.evaluation_mode;
  return config.evaluation_page_scope?.mode === "selected" ? "deep" : "all_pages";
}

export function isQuickEvaluation(config: ExperimentConfig): boolean {
  return experimentEvaluationMode(config) === "quick";
}

/** Apply current safety floors to persisted quick runs created with older defaults. */
export function evaluationCallBudgetUsd(config: ExperimentConfig, fallback: number): number {
  const configured = config.evaluation_call_budget_usd ?? fallback;
  return isQuickEvaluation(config)
    ? Math.max(configured, QUICK_EVALUATION_CALL_BUDGET_USD)
    : configured;
}

export function evaluationModeLabel(mode: ExperimentEvaluationMode): string {
  if (mode === "quick") return "Quick eval";
  if (mode === "deep") return "Deep audit";
  return "All-pages audit";
}

export function quickRubricPolicy(policy: RubricPolicy): RubricPolicy {
  return Object.fromEntries(Object.entries(policy).map(([id, rubric]) => {
    if (!QUICK_RUBRICS.has(id as TomeRubricId)) {
      return [id, { ...rubric, enabled: false, blocking: false }];
    }
    if (id === "atomic_claim_inventory") {
      return [id, { ...rubric, enabled: true, blocking: true, min_count: 1 }];
    }
    return [id, rubric];
  })) as RubricPolicy;
}
