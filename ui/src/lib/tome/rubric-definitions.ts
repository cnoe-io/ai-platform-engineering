import type { TomeRubricId } from "@/types/tome-evaluation";

export interface RubricDefinition {
  label: string;
  description: string;
}

/** Shared user-facing glossary for quality policy controls and evaluation reports. */
export const RUBRIC_DEFINITIONS: Record<TomeRubricId, RubricDefinition> = {
  atomic_claim_inventory: {
    label: "Atomic Claim Inventory",
    description: "Checks that every factual claim is identified as an exact, traceable text span in the candidate output.",
  },
  claim_evidence: {
    label: "Claim Evidence",
    description: "Measures how many supported or partially supported claims reference valid items from the frozen evidence bundle.",
  },
  citation_coverage: {
    label: "Citation Coverage",
    description: "Measures the share of checkable claims that include both a citation and a frozen-evidence reference.",
  },
  citation_correctness: {
    label: "Citation Correctness",
    description: "Checks whether cited evidence actually supports the claim classification assigned by the evaluator.",
  },
  citation_specificity: {
    label: "Citation Specificity",
    description: "Checks whether citations point to a sufficiently precise source location instead of only a broad source.",
  },
  grounding: {
    label: "Grounding",
    description: "Scores checkable claims by evidence support: supported claims count fully and partially supported claims count half.",
  },
  unsupported_claims: {
    label: "Unsupported Claims",
    description: "Counts factual claims that the frozen evidence does not support. Lower rates are better.",
  },
  contradictions: {
    label: "Contradictions",
    description: "Counts claims that conflict with the frozen evidence. Lower counts and rates are better.",
  },
  unverifiable_claims: {
    label: "Unverifiable Claims",
    description: "Counts claims that cannot be confirmed or rejected using the frozen evidence. Lower rates are better.",
  },
  unsupported_critical_claims: {
    label: "Unsupported Critical Claims",
    description: "Counts unsupported high-impact claims such as ownership, commitments, dates, security, financial, or project-status statements.",
  },
  fabricated_entities: {
    label: "Fabricated Entities",
    description: "Counts people, organizations, products, partners, or other named entities invented without evidence.",
  },
  fabricated_quantitative_details: {
    label: "Fabricated Quantitative Details",
    description: "Counts invented numbers, dates, percentages, measurements, or other quantitative details.",
  },
  explicit_gaps: {
    label: "Explicit Gaps",
    description: "Checks whether the output clearly discloses important information gaps instead of filling them with assumptions.",
  },
  semantic_fidelity: {
    label: "Semantic Fidelity",
    description: "Checks whether the output preserves the meaning of the frozen source material without material distortion.",
  },
  conflict_disclosure: {
    label: "Conflict Disclosure",
    description: "Checks whether conflicts between sources are surfaced clearly rather than silently resolved or omitted.",
  },
  source_freshness: {
    label: "Source Freshness",
    description: "Checks whether claims rely on the newest eligible sources included in the frozen evidence snapshot.",
  },
  material_coverage: {
    label: "Material Coverage",
    description: "Measures whether the output covers the important facts and topics present in the frozen evidence.",
  },
  scope_fidelity: {
    label: "Scope Fidelity",
    description: "Checks that the output stays within the selected entity and operation scope.",
  },
  stable_page_preservation: {
    label: "Stable Page Preservation",
    description: "Checks that pages designated as stable remain unchanged when the operation is required to preserve them.",
  },
  template_compliance: {
    label: "Template Compliance",
    description: "Checks that required pages, frontmatter, sections, and template instructions are satisfied.",
  },
  internal_link_validity: {
    label: "Internal Link Validity",
    description: "Checks that internal TOME links resolve to pages available in the candidate or frozen page set.",
  },
  attribution_integrity: {
    label: "Attribution Integrity",
    description: "Checks that ownership, partner, and customer attributions are made only when supported by evidence.",
  },
  evaluator_confidence: {
    label: "Evaluator Confidence",
    description: "Reports the judge model's confidence across non-abstained claim decisions; it is not independent proof of correctness.",
  },
  cost_efficiency: {
    label: "Cost Efficiency",
    description: "Reports candidate-generation and evaluator model cost in USD. Treat this as telemetry unless a policy threshold is configured.",
  },
  latency_efficiency: {
    label: "Latency Efficiency",
    description: "Reports candidate-generation and evaluator latency. Treat this as telemetry unless a policy threshold is configured.",
  },
};
