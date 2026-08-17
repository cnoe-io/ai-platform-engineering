import { defaultRubricPolicy } from "@/lib/tome/evaluation-store";
import {
  evaluationPaths,
  normalizeExperimentPageScope,
  pageIsInEvaluationScope,
  scopedRubrics,
} from "@/lib/tome/experiment-page-scope";
import type {
  ExperimentArtifact,
  ExperimentConfig,
  RubricResult,
} from "@/types/tome-evaluation";

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

function config(scope?: ExperimentConfig["evaluation_page_scope"]): ExperimentConfig {
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
    cost_ceiling_usd: 10,
    promotion_mode: "manual",
    rubric_policy: defaultRubricPolicy(),
    rubric_policy_version: 1,
    rubric_policy_scope: "global",
    rubric_policy_scope_id: null,
    quality_policy_mode: "enforce",
    require_human_review: true,
    allow_steward_override: false,
    prompt_hash: "1".repeat(64),
    tool_contract_version: "v1",
    template_versions: {},
    turn_limit: 100,
    seed: 1,
    ...(scope ? { evaluation_page_scope: scope } : {}),
  };
}

function artifact(id: string, paths: string[]): ExperimentArtifact {
  return {
    _id: id,
    experiment_id: "experiment-1",
    project_id: "project-1",
    trial: 1,
    candidate: id === "a" ? "a" : "b",
    blind_label: id,
    model: `provider/model-${id}`,
    run_identity: `run-${id}`,
    evidence_bundle_id: "bundle-1",
    pages: paths.map((path) => ({
      path,
      markdown: `# ${path}`,
      content_hash: path.padEnd(64, "0"),
      written_at: "2026-01-01T00:00:00.000Z",
    })),
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("experiment page scope", () => {
  it("keeps legacy runs on all generated pages", () => {
    expect(evaluationPaths(config(), [
      artifact("a", ["overview.md", "status.md"]),
      artifact("b", ["overview.md", "risks.md"]),
    ])).toEqual(["overview.md", "risks.md", "status.md"]);
    expect(pageIsInEvaluationScope(config(), "anything.md")).toBe(true);
  });

  it("normalizes and freezes selected paths", () => {
    expect(normalizeExperimentPageScope({
      mode: "selected",
      paths: [" status.md ", "overview.md", "status.md"],
    }, new Set(["overview.md", "status.md"]))).toEqual({
      mode: "selected",
      paths: ["overview.md", "status.md"],
    });
  });

  it("rejects empty, unsafe, and unavailable selections", () => {
    expect(() => normalizeExperimentPageScope({ mode: "selected", paths: [] }))
      .toThrow("Select at least one page");
    expect(() => normalizeExperimentPageScope({ mode: "selected", paths: ["../secret.md"] }))
      .toThrow("Invalid evaluation page path");
    expect(() => normalizeExperimentPageScope(
      { mode: "selected", paths: ["missing.md"] },
      new Set(["overview.md"]),
    )).toThrow("not available in the frozen manifest");
  });

  it("uses exactly the selected paths and disables whole-project rubrics", () => {
    const selectedConfig = config({ mode: "selected", paths: ["status.md"] });
    expect(evaluationPaths(selectedConfig, [
      artifact("a", ["overview.md", "status.md"]),
      artifact("b", ["overview.md", "status.md"]),
    ])).toEqual(["status.md"]);
    expect(pageIsInEvaluationScope(selectedConfig, "status.md")).toBe(true);
    expect(pageIsInEvaluationScope(selectedConfig, "overview.md")).toBe(false);

    const rubrics: RubricResult[] = [
      {
        id: "material_coverage",
        enabled: true,
        passed: true,
        blocking: true,
        score: 1,
        findings: [],
      },
      {
        id: "grounding",
        enabled: true,
        passed: true,
        blocking: true,
        score: 1,
        findings: [],
      },
    ];
    const result = scopedRubrics(rubrics, selectedConfig);
    expect(result[0]).toMatchObject({ enabled: false, passed: null, blocking: false });
    expect(result[0].findings).toEqual(["Not assessed in a selected-page evaluation."]);
    expect(result[1]).toEqual(rubrics[1]);
  });

  it("keeps the compact deterministic and safety rubric for quick evaluations", () => {
    const quickConfig = config({ mode: "selected", paths: ["status.md"] });
    quickConfig.evaluation_mode = "quick";
    const rubrics: RubricResult[] = [
      { id: "template_compliance", enabled: true, passed: true, blocking: true, findings: [] },
      { id: "fabricated_entities", enabled: true, passed: true, blocking: true, findings: [] },
      { id: "material_coverage", enabled: true, passed: true, blocking: true, findings: [] },
    ];

    const result = scopedRubrics(rubrics, quickConfig);

    expect(result[0]).toEqual(rubrics[0]);
    expect(result[1]).toEqual(rubrics[1]);
    expect(result[2]).toMatchObject({ enabled: false, passed: null, blocking: false });
    expect(result[2].findings).toEqual(["Not assessed in a quick evaluation."]);
  });
});
