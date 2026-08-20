import { calculateRubrics } from "@/lib/tome/rubric-evaluator";
import type {
  ArtifactEvaluation,
  ExperimentArtifact,
  RubricPolicy,
  RubricResult,
  TomeRubricId,
} from "@/types/tome-evaluation";

const PAGE_CLAIM_RUBRICS = new Set<TomeRubricId>([
  "atomic_claim_inventory",
  "claim_evidence",
  "citation_coverage",
  "citation_correctness",
  "citation_specificity",
  "grounding",
  "unsupported_claims",
  "contradictions",
  "unverifiable_claims",
  "unsupported_critical_claims",
  "fabricated_entities",
  "fabricated_quantitative_details",
  "attribution_integrity",
  "evaluator_confidence",
]);

export interface PageEvaluationStats {
  claimCount: number;
  supported: number;
  partiallySupported: number;
  unsupported: number;
  contradicted: number;
  unverifiable: number;
  supportRate: number | null;
  citationCoverage: number | null;
  confidence: number | null;
}

export interface PageEvaluationView {
  rubrics: RubricResult[];
  stats: PageEvaluationStats;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function buildPageEvaluationView(
  evaluation: ArtifactEvaluation | undefined,
  artifact: ExperimentArtifact,
  path: string,
  policy: RubricPolicy,
): PageEvaluationView | null {
  if (!evaluation) return null;
  const claims = evaluation.claims.filter((claim) => claim.page === path);
  const supported = claims.filter((claim) => claim.classification === "supported").length;
  const partiallySupported = claims.filter(
    (claim) => claim.classification === "partially_supported",
  ).length;
  const unsupported = claims.filter((claim) => claim.classification === "unsupported").length;
  const contradicted = claims.filter((claim) => claim.classification === "contradicted").length;
  const unverifiable = claims.filter((claim) => claim.classification === "unverifiable").length;
  const citationCovered = claims.filter(
    (claim) => claim.citations.length > 0 && claim.evidence.length > 0,
  ).length;
  const confidenceTotal = claims.reduce(
    (sum, claim) => sum + (claim.abstained ? 0 : claim.confidence),
    0,
  );
  const evidenceItems = [...new Map(claims.flatMap((claim) => claim.evidence).map((evidence) => [
    `${evidence.evidence_item_id}\n${evidence.canonical_uri}\n${evidence.content_hash}`,
    {
      id: evidence.evidence_item_id,
      canonical_uri: evidence.canonical_uri,
      content_hash: evidence.content_hash,
    },
  ])).values()];
  const page = artifact.pages.find((candidate) => candidate.path === path);
  const rubrics = claims.length === 0 || !page
    ? []
    : calculateRubrics(policy, {
        claims,
        candidatePages: { [path]: page.markdown },
        evidencePagePaths: artifact.pages.map((candidate) => candidate.path),
        evidenceItems,
        requiredTemplatePaths: [],
      }).filter((rubric) => PAGE_CLAIM_RUBRICS.has(rubric.id));

  return {
    rubrics,
    stats: {
      claimCount: claims.length,
      supported,
      partiallySupported,
      unsupported,
      contradicted,
      unverifiable,
      supportRate: ratio(supported + 0.5 * partiallySupported, claims.length),
      citationCoverage: ratio(citationCovered, claims.length),
      confidence: ratio(confidenceTotal, claims.length),
    },
  };
}
