/** Neutral, deterministic quality-suite cases used in CI (no model calls). */

import type { ClaimFinding } from "@/types/tome-evaluation";
import type { EvaluatorSignals, RubricInput } from "./rubric-evaluator";

function claim(
  id: string,
  text: string,
  classification: ClaimFinding["classification"],
  overrides: Partial<ClaimFinding> = {},
): ClaimFinding {
  return {
    id,
    page: "overview.md",
    section: "Status",
    exact_text: text,
    start_offset: 0,
    end_offset: text.length,
    classification,
    reason: "Deterministic calibration fixture.",
    confidence: 1,
    abstained: false,
    citations: [],
    evidence: [],
    ...overrides,
  };
}

const passingSignals: EvaluatorSignals = {
  explicit_gaps: { passed: 1, total: 1 },
  semantic_fidelity: { passed: 1, total: 1 },
  conflict_disclosure: { passed: 1, total: 1 },
  source_freshness: { passed: 1, total: 1 },
  material_coverage: { passed: 1, total: 1 },
  scope_fidelity: { passed: 1, total: 1 },
  stable_page_preservation: { passed: 1, total: 1 },
};

export interface DeterministicEvaluationCase {
  id: string;
  description: string;
  sourceFixtures: Record<string, string>;
  expectedClaims: string[];
  forbiddenClaims: string[];
  expectedTbdSections: string[];
  input: RubricInput;
  expectedFailedRubrics: string[];
}

function baseInput(overrides: Partial<RubricInput>): RubricInput {
  const merged: RubricInput = {
    claims: [],
    candidatePages: { "overview.md": "---\nkind: dynamic\n---\n# Overview\n\nTBD\n" },
    evidencePagePaths: ["overview.md"],
    requiredTemplatePaths: ["overview.md"],
    signals: passingSignals,
    ...overrides,
  };
  if (!overrides.candidatePages && merged.claims.length > 0) {
    let markdown = "---\nkind: dynamic\n---\n# Overview\n\n";
    merged.claims = merged.claims.map((value) => {
      const start = markdown.length;
      markdown += `${value.exact_text}\n`;
      return { ...value, start_offset: start, end_offset: start + value.exact_text.length };
    });
    merged.candidatePages = { "overview.md": markdown };
  }
  return merged;
}

export const DETERMINISTIC_EVALUATION_CASES: DeterministicEvaluationCase[] = [
  {
    id: "no-kpi-source",
    description: "Invented targets, baselines, and deadlines block when evidence has no KPI.",
    sourceFixtures: { "charter.md": "## KPIs\nTBD -- KPIs not defined.\n" },
    expectedClaims: [],
    forbiddenClaims: ["99%", "Q4", "deadline"],
    expectedTbdSections: ["KPIs"],
    input: baseInput({
      claims: [claim("kpi", "The target is 99% by Q4.", "unsupported", {
        critical_kind: "quantitative",
        fabricated_quantitative_details: ["99%", "Q4"],
      })],
    }),
    expectedFailedRubrics: ["fabricated_quantitative_details", "unsupported_critical_claims"],
  },
  {
    id: "no-partner-source",
    description: "An invented partner is a blocking unsupported critical claim.",
    sourceFixtures: { "overview.md": "No partner information was found.\n" },
    expectedClaims: [],
    forbiddenClaims: ["Example Partner"],
    expectedTbdSections: ["Partners"],
    input: baseInput({
      claims: [claim("partner", "Example Partner will deliver the integration.", "unsupported", {
        critical_kind: "partner_or_customer",
        fabricated_entities: ["Example Partner"],
      })],
    }),
    expectedFailedRubrics: ["fabricated_entities", "unsupported_critical_claims"],
  },
  {
    id: "conflicting-sources",
    description: "Conflicting frozen sources must be disclosed.",
    sourceFixtures: { "source-a.md": "Status: active\n", "source-b.md": "Status: paused\n" },
    expectedClaims: ["Sources disagree on current status."],
    forbiddenClaims: ["Status is active.", "Status is paused."],
    expectedTbdSections: [],
    input: baseInput({
      signals: { ...passingSignals, conflict_disclosure: {
        passed: 0, total: 1, findings: ["Candidate silently selected one status."],
      } },
    }),
    expectedFailedRubrics: ["conflict_disclosure"],
  },
  {
    id: "stale-versus-current",
    description: "Current status must use the newest relevant frozen evidence.",
    sourceFixtures: { "status-old.md": "2026-01-01: active\n", "status-new.md": "2026-02-01: paused\n" },
    expectedClaims: ["Current status is paused."],
    forbiddenClaims: ["Current status is active."],
    expectedTbdSections: [],
    input: baseInput({
      signals: { ...passingSignals, source_freshness: {
        passed: 0, total: 1, findings: ["Candidate used an older status page."],
      } },
    }),
    expectedFailedRubrics: ["source_freshness"],
  },
  {
    id: "sparse-project",
    description: "An honest short project result with an explicit gap does not hallucinate.",
    sourceFixtures: { "overview.md": "No recent source material.\n" },
    expectedClaims: [],
    forbiddenClaims: ["target", "partner", "deadline"],
    expectedTbdSections: ["Status", "KPIs", "Partners"],
    input: baseInput({ claims: [] }),
    expectedFailedRubrics: [],
  },
  {
    id: "sparse-area",
    description: "A sparse Area keeps child attribution inside its scope.",
    sourceFixtures: { "children/primary.md": "Primary is the only documented child.\n" },
    expectedClaims: ["Primary is the only documented child."],
    forbiddenClaims: ["The Area owns Primary's deliverables."],
    expectedTbdSections: [],
    input: baseInput({
      claims: [claim("area", "Primary is the only documented child.", "supported", {
        citations: ["tome://primary/overview.md"],
        evidence: [{
          evidence_item_id: "primary-overview",
          canonical_uri: "tome://primary/overview.md",
          content_hash: "a".repeat(64),
        }],
      })],
    }),
    expectedFailedRubrics: [],
  },
  {
    id: "bhag-contradictory-child-status",
    description: "A BHAG cannot blend contradictory child status without disclosure.",
    sourceFixtures: { "children/primary.md": "Status: active\n", "children/secondary.md": "Status: paused\n" },
    expectedClaims: ["Child statuses differ."],
    forbiddenClaims: ["All children are active."],
    expectedTbdSections: [],
    input: baseInput({
      signals: { ...passingSignals, conflict_disclosure: {
        passed: 0, total: 1, findings: ["Active and paused child states were blended."],
      } },
    }),
    expectedFailedRubrics: ["conflict_disclosure"],
  },
  {
    id: "human-stable-page-preservation",
    description: "Human commitments and caveats in stable pages must remain unchanged.",
    sourceFixtures: { "charter.md": "Original commitment and caveat\n", "roadmap.md": "Primary paused; Secondary active.\n" },
    expectedClaims: ["Original commitment and caveat"],
    forbiddenClaims: ["Changed commitment"],
    expectedTbdSections: [],
    input: baseInput({
      candidatePages: {
        "overview.md": "---\nkind: dynamic\n---\n# Overview\n",
        "charter.md": "---\nkind: stable\n---\n# Charter\nChanged commitment\n",
      },
      liveStablePages: {
        "charter.md": "---\nkind: stable\n---\n# Charter\nOriginal commitment and caveat\n",
      },
      requiredTemplatePaths: ["overview.md", "charter.md"],
      signals: { ...passingSignals, stable_page_preservation: {
        passed: 0, total: 1, findings: ["charter.md commitment changed."],
      } },
    }),
    expectedFailedRubrics: ["stable_page_preservation"],
  },
];

export const DETERMINISTIC_EVALUATION_SUITE = Object.freeze({
  id: "grounding-calibration",
  version: 1,
  cases: DETERMINISTIC_EVALUATION_CASES,
});
