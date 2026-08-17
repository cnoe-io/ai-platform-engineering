import { defaultRubricPolicy } from "@/lib/tome/evaluation-store";
import {
  QUICK_EVALUATION_CALL_BUDGET_USD,
  QUICK_RUBRICS,
  evaluationCallBudgetUsd,
  experimentEvaluationMode,
  quickRubricPolicy,
} from "@/lib/tome/experiment-mode";
import type { ExperimentConfig } from "@/types/tome-evaluation";

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

function config(overrides: Partial<ExperimentConfig> = {}): ExperimentConfig {
  return {
    evaluation_suite_id: "example-suite",
    evaluation_suite_version: 1,
    model_a: "provider/model-a",
    model_b: "provider/model-b",
    evaluator_model: "provider/evaluator",
    operation: "ingest",
    entity_type: "project",
    entity_id: "project-1",
    repeat_count: 1,
    cost_ceiling_usd: 3,
    promotion_mode: "manual",
    rubric_policy: defaultRubricPolicy(),
    rubric_policy_version: 1,
    rubric_policy_scope: "global",
    rubric_policy_scope_id: null,
    quality_policy_mode: "observe",
    require_human_review: true,
    allow_steward_override: false,
    prompt_hash: "1".repeat(64),
    tool_contract_version: "v1",
    template_versions: {},
    turn_limit: 30,
    seed: 1,
    ...overrides,
  };
}

describe("experiment evaluation modes", () => {
  it("preserves legacy selected and all-pages semantics", () => {
    expect(experimentEvaluationMode(config({
      evaluation_page_scope: { mode: "selected", paths: ["overview.md"] },
    }))).toBe("deep");
    expect(experimentEvaluationMode(config({
      evaluation_page_scope: { mode: "all", paths: [] },
    }))).toBe("all_pages");
  });

  it("keeps only the compact quick-evaluation rubric", () => {
    const policy = quickRubricPolicy(defaultRubricPolicy());
    for (const [id, rubric] of Object.entries(policy)) {
      expect(rubric.enabled).toBe(QUICK_RUBRICS.has(id as keyof typeof policy));
      if (!rubric.enabled) expect(rubric.blocking).toBe(false);
    }
    expect(policy.template_compliance.enabled).toBe(true);
    expect(policy.claim_evidence.enabled).toBe(true);
    expect(policy.grounding.enabled).toBe(true);
    expect(policy.fabricated_entities.enabled).toBe(true);
    expect(policy.fabricated_quantitative_details.enabled).toBe(true);
    expect(policy.contradictions.enabled).toBe(true);
    expect(policy.unsupported_critical_claims.enabled).toBe(true);
  });

  it("upgrades old quick-run call budgets without changing deep runs", () => {
    expect(evaluationCallBudgetUsd(config({
      evaluation_mode: "quick",
      evaluation_call_budget_usd: 0.5,
    }), 2)).toBe(QUICK_EVALUATION_CALL_BUDGET_USD);
    expect(evaluationCallBudgetUsd(config({
      evaluation_mode: "deep",
      evaluation_call_budget_usd: 0.5,
    }), 2)).toBe(0.5);
  });
});
