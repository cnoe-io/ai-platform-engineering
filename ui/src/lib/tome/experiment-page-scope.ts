import type {
  ExperimentArtifact,
  ExperimentConfig,
  ExperimentPageScope,
  RubricResult,
} from "@/types/tome-evaluation";
import { isQuickEvaluation, QUICK_RUBRICS } from "@/lib/tome/experiment-mode";

const MAX_SELECTED_PAGES = 100;
const WHOLE_ENTITY_RUBRICS = new Set([
  "material_coverage",
  "scope_fidelity",
  "stable_page_preservation",
  "template_compliance",
  "internal_link_validity",
]);

function validPagePath(path: string): boolean {
  const parts = path.split("/");
  return path.endsWith(".md")
    && !path.startsWith("/")
    && parts.every((part) => Boolean(part) && part !== "." && part !== "..");
}

export function normalizeExperimentPageScope(
  input: ExperimentPageScope | undefined,
  availablePaths?: ReadonlySet<string>,
): ExperimentPageScope {
  if (!input || input.mode === "all") return { mode: "all", paths: [] };
  if (input.mode !== "selected" || !Array.isArray(input.paths)) {
    throw new Error("Evaluation page scope must be selected pages or all pages.");
  }
  const paths = [...new Set(input.paths.map((path) => path.trim()).filter(Boolean))].sort();
  if (paths.length === 0) throw new Error("Select at least one page to evaluate.");
  if (paths.length > MAX_SELECTED_PAGES) {
    throw new Error(`Select no more than ${MAX_SELECTED_PAGES} pages per evaluation.`);
  }
  const invalid = paths.find((path) => !validPagePath(path));
  if (invalid) throw new Error(`Invalid evaluation page path: ${invalid}`);
  const unavailable = availablePaths && paths.find((path) => !availablePaths.has(path));
  if (unavailable) throw new Error(`Selected page is not available in the frozen manifest: ${unavailable}`);
  return { mode: "selected", paths };
}

export function isSelectedPageEvaluation(config: ExperimentConfig): boolean {
  return config.evaluation_page_scope?.mode === "selected";
}

export function evaluationPaths(
  config: ExperimentConfig,
  artifacts: ExperimentArtifact[],
): string[] {
  if (isSelectedPageEvaluation(config)) {
    return [...(config.evaluation_page_scope?.paths ?? [])];
  }
  return [...new Set(artifacts.flatMap((artifact) => artifact.pages.map((page) => page.path)))].sort();
}

export function pageIsInEvaluationScope(config: ExperimentConfig, path: string): boolean {
  return !isSelectedPageEvaluation(config)
    || Boolean(config.evaluation_page_scope?.paths.includes(path));
}

export function scopedRubrics(
  rubrics: RubricResult[],
  config: ExperimentConfig,
): RubricResult[] {
  const quick = isQuickEvaluation(config);
  if (!quick && !isSelectedPageEvaluation(config)) return rubrics;
  return rubrics.map((rubric) => (quick
    ? !QUICK_RUBRICS.has(rubric.id)
    : WHOLE_ENTITY_RUBRICS.has(rubric.id))
    ? {
      ...rubric,
      enabled: false,
      passed: null,
      blocking: false,
      score: undefined,
      count: undefined,
      rate: undefined,
      numerator: undefined,
      denominator: undefined,
      findings: [quick
        ? "Not assessed in a quick evaluation."
        : "Not assessed in a selected-page evaluation."],
    }
    : rubric);
}

export const __test = { validPagePath, WHOLE_ENTITY_RUBRICS };
