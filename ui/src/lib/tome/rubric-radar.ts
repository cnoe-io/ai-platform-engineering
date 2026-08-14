import type { RubricResult, TomeRubricId } from "@/types/tome-evaluation";

export interface RubricRadarDimension {
  id: string;
  label: string;
  description: string;
  rubricIds: readonly TomeRubricId[];
}

export interface RubricRadarScore extends RubricRadarDimension {
  score: number | null;
}

export const RUBRIC_RADAR_DIMENSIONS: readonly RubricRadarDimension[] = [
  {
    id: "claims",
    label: "Claim quality",
    description: "Combines exact claim inventory and valid evidence support for factual claims.",
    rubricIds: ["atomic_claim_inventory", "claim_evidence"],
  },
  {
    id: "citations",
    label: "Citations",
    description: "Combines citation coverage, correctness, and source-location specificity.",
    rubricIds: ["citation_coverage", "citation_correctness", "citation_specificity"],
  },
  {
    id: "grounding",
    label: "Grounding",
    description: "Measures how strongly the frozen evidence supports the candidate's checkable claims.",
    rubricIds: ["grounding"],
  },
  {
    id: "safety",
    label: "Hallucination safety",
    description: "Inverts unsupported, contradicted, unverifiable, critical, and fabricated finding rates so higher is safer.",
    rubricIds: [
      "unsupported_claims",
      "contradictions",
      "unverifiable_claims",
      "unsupported_critical_claims",
      "fabricated_entities",
      "fabricated_quantitative_details",
    ],
  },
  {
    id: "gaps",
    label: "Gap disclosure",
    description: "Measures whether important missing information is explicitly acknowledged.",
    rubricIds: ["explicit_gaps"],
  },
  {
    id: "fidelity",
    label: "Fidelity",
    description: "Combines meaning preservation, conflict disclosure, freshness, coverage, scope, and stable-page preservation.",
    rubricIds: [
      "semantic_fidelity",
      "conflict_disclosure",
      "source_freshness",
      "material_coverage",
      "scope_fidelity",
      "stable_page_preservation",
    ],
  },
  {
    id: "structure",
    label: "Structure",
    description: "Combines template compliance and valid internal TOME links.",
    rubricIds: ["template_compliance", "internal_link_validity"],
  },
  {
    id: "attribution",
    label: "Attribution",
    description: "Measures whether ownership, partner, and customer attributions are evidence-backed.",
    rubricIds: ["attribution_integrity"],
  },
  {
    id: "confidence",
    label: "Judge confidence",
    description: "Reports the evaluator model's confidence; it is not independent evidence that the judgment is correct.",
    rubricIds: ["evaluator_confidence"],
  },
] as const;

const NEGATIVE_RUBRICS = new Set<TomeRubricId>([
  "unsupported_claims",
  "contradictions",
  "unverifiable_claims",
  "unsupported_critical_claims",
  "fabricated_entities",
  "fabricated_quantitative_details",
]);

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Convert heterogeneous rubric output to a 0..1 quality score where higher is better. */
export function rubricQualityScore(rubric: RubricResult): number | null {
  if (!rubric.enabled) return null;

  if (NEGATIVE_RUBRICS.has(rubric.id)) {
    if (rubric.rate !== undefined) return 1 - clampScore(rubric.rate);
    if (rubric.count !== undefined) {
      if (rubric.denominator !== undefined && rubric.denominator > 0) {
        return 1 - clampScore(rubric.count / rubric.denominator);
      }
      return rubric.count === 0 ? 1 : 0;
    }
  }

  if (rubric.score !== undefined) return clampScore(rubric.score);
  if (rubric.rate !== undefined) return clampScore(rubric.rate);
  if (rubric.passed !== null) return rubric.passed ? 1 : 0;
  return null;
}

export function buildRubricRadarScores(rubrics: RubricResult[]): RubricRadarScore[] {
  const byId = new Map(rubrics.map((rubric) => [rubric.id, rubric]));
  return RUBRIC_RADAR_DIMENSIONS.map((dimension) => {
    const values = dimension.rubricIds
      .map((id) => byId.get(id))
      .filter((rubric): rubric is RubricResult => Boolean(rubric))
      .map(rubricQualityScore)
      .filter((score): score is number => score !== null);
    return {
      ...dimension,
      score: values.length > 0
        ? values.reduce((sum, score) => sum + score, 0) / values.length
        : null,
    };
  });
}
