/** Deterministic calculations over structured evaluator findings. */

import { parseFrontmatter } from "@/lib/tome/schema";
import type {
  ArtifactEvaluation,
  ClaimFinding,
  ExperimentAggregate,
  ExperimentArtifact,
  QualityGateDecision,
  QualityPolicy,
  RubricPolicy,
  RubricResult,
  TomeExperiment,
  TomeRubricId,
} from "@/types/tome-evaluation";
import { TOME_RUBRIC_IDS } from "@/types/tome-evaluation";

export interface EvaluatorSignals {
  semantic_fidelity?: { passed: number; total: number; findings?: string[] };
  conflict_disclosure?: { passed: number; total: number; findings?: string[] };
  source_freshness?: { passed: number; total: number; findings?: string[] };
  material_coverage?: { passed: number; total: number; findings?: string[] };
  scope_fidelity?: { passed: number; total: number; findings?: string[] };
  stable_page_preservation?: { passed: number; total: number; findings?: string[] };
  explicit_gaps?: { passed: number; total: number; findings?: string[] };
}

export interface RubricInput {
  claims: ClaimFinding[];
  candidatePages: Record<string, string>;
  evidencePagePaths: string[];
  evidenceItems?: Array<{ id: string; canonical_uri: string; content_hash: string }>;
  requiredTemplatePaths: string[];
  requiredTemplates?: Array<{ path: string; kind: string; body?: string }>;
  liveStablePages?: Record<string, string>;
  signals?: EvaluatorSignals;
  generationCostUsd?: number;
  evaluationCostUsd?: number;
  generationLatencyMs?: number;
  evaluationLatencyMs?: number;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 1;
}

function passesMetric(
  input: { score?: number; count?: number; rate?: number },
  threshold: NonNullable<RubricResult["threshold"]>,
): boolean {
  const comparable = input.score ?? input.rate ?? input.count;
  if (threshold.min !== undefined && (comparable === undefined || comparable < threshold.min)) return false;
  if (threshold.max !== undefined && (comparable === undefined || comparable > threshold.max)) return false;
  if (threshold.min_count !== undefined && (input.count === undefined || input.count < threshold.min_count)) return false;
  if (threshold.max_count !== undefined && (input.count === undefined || input.count > threshold.max_count)) return false;
  if (threshold.min_rate !== undefined && (input.rate === undefined || input.rate < threshold.min_rate)) return false;
  if (threshold.max_rate !== undefined && (input.rate === undefined || input.rate > threshold.max_rate)) return false;
  return true;
}

function metric(
  id: TomeRubricId,
  policy: RubricPolicy,
  input: {
    score?: number;
    count?: number;
    rate?: number;
    numerator?: number;
    denominator?: number;
    findings?: string[];
  },
): RubricResult {
  const config = policy[id];
  if (!config.enabled) {
    return { id, enabled: false, passed: null, blocking: config.blocking, findings: [] };
  }
  const threshold = {
    ...(config.min !== undefined ? { min: config.min } : {}),
    ...(config.max !== undefined ? { max: config.max } : {}),
    ...(config.min_count !== undefined ? { min_count: config.min_count } : {}),
    ...(config.max_count !== undefined ? { max_count: config.max_count } : {}),
    ...(config.min_rate !== undefined ? { min_rate: config.min_rate } : {}),
    ...(config.max_rate !== undefined ? { max_rate: config.max_rate } : {}),
  };
  const hasThreshold = Object.keys(threshold).length > 0;
  return {
    id,
    enabled: true,
    passed: !hasThreshold ? null : passesMetric(input, threshold),
    blocking: config.blocking,
    ...input,
    ...(hasThreshold ? { threshold } : {}),
    findings: input.findings ?? [],
  };
}

function signalMetric(
  id: keyof EvaluatorSignals,
  policy: RubricPolicy,
  signals: EvaluatorSignals,
): RubricResult {
  const value = signals[id];
  return metric(id, policy, value
    ? {
        score: ratio(value.passed, value.total),
        numerator: value.passed,
        denominator: value.total,
        findings: value.findings,
      }
    : { findings: ["Evaluator did not return this required signal."] });
}

function isSpecificCitation(uri: string): boolean {
  try {
    const parsed = new URL(uri.replace(/^tome:\/\//, "https://tome.invalid/"));
    return parsed.pathname.split("/").filter(Boolean).length >= 2 || Boolean(parsed.hash);
  } catch {
    return false;
  }
}

function internalLinkFindings(
  pages: Record<string, string>,
  evidencePagePaths: string[],
): { valid: number; total: number; findings: string[] } {
  const paths = new Set([...Object.keys(pages), ...evidencePagePaths]);
  let total = 0;
  let valid = 0;
  const findings: string[] = [];
  for (const [page, markdown] of Object.entries(pages)) {
    const links = markdown.matchAll(/\[[^\]]+\]\((tome:\/\/[^)]+)\)/g);
    for (const match of links) {
      total += 1;
      const raw = match[1].replace(/^tome:\/\/[^/]+\//, "").split(/[?#]/)[0];
      if (paths.has(raw)) valid += 1;
      else findings.push(`${page}: unresolved internal link ${match[1]}`);
    }
  }
  return { valid, total, findings };
}

function templateFindings(
  pages: Record<string, string>,
  requiredPaths: string[],
  requiredTemplates: RubricInput["requiredTemplates"] = [],
): { valid: number; total: number; findings: string[] } {
  const findings: string[] = [];
  let valid = 0;
  const specs = new Map(requiredTemplates.map((template) => [template.path, template]));
  for (const path of requiredPaths) {
    const markdown = pages[path];
    if (!markdown) {
      findings.push(`Missing required template page ${path}.`);
      continue;
    }
    const [frontmatter, body] = parseFrontmatter(markdown);
    if (!frontmatter.kind) {
      findings.push(`${path}: missing frontmatter kind.`);
      continue;
    }
    const spec = specs.get(path);
    if (spec?.kind && frontmatter.kind !== spec.kind) {
      findings.push(`${path}: expected kind ${spec.kind}, found ${String(frontmatter.kind)}.`);
      continue;
    }
    const requiredHeadings = [...(spec?.body ?? "").matchAll(/^##+\s+(.+)$/gm)]
      .map((match) => match[1].trim());
    const missingHeadings = requiredHeadings.filter(
      (heading) => !new RegExp(`^##+\\s+${escapeRegExp(heading)}\\s*$`, "m").test(body),
    );
    if (missingHeadings.length > 0) {
      findings.push(`${path}: missing required headings: ${missingHeadings.join(", ")}.`);
      continue;
    }
    if (/^\|\s*:?-{3,}/m.test(spec?.body ?? "") && !/^\|\s*:?-{3,}/m.test(body)) {
      findings.push(`${path}: missing required Markdown table structure.`);
      continue;
    }
    valid += 1;
  }
  return { valid, total: requiredPaths.length, findings };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stablePreservation(
  candidatePages: Record<string, string>,
  liveStablePages: Record<string, string>,
): { valid: number; total: number; findings: string[] } {
  const findings: string[] = [];
  let valid = 0;
  for (const [path, original] of Object.entries(liveStablePages)) {
    if (!(path in candidatePages) || candidatePages[path] === original) valid += 1;
    else findings.push(`${path}: human-owned stable content was altered.`);
  }
  return { valid, total: Object.keys(liveStablePages).length, findings };
}

export function calculateRubrics(policy: RubricPolicy, input: RubricInput): RubricResult[] {
  const claims = input.claims;
  const invalidClaimSpans = claims.filter((claim) => {
    const page = input.candidatePages[claim.page];
    return !page
      || !claim.exact_text.trim()
      || claim.end_offset <= claim.start_offset
      || page.slice(claim.start_offset, claim.end_offset) !== claim.exact_text;
  });
  const evidenceIndex = input.evidenceItems
    ? new Set(input.evidenceItems.map((item) => `${item.id}\n${item.canonical_uri}\n${item.content_hash}`))
    : null;
  const validEvidence = (claim: ClaimFinding) => claim.evidence.filter((evidence) =>
    !evidenceIndex || evidenceIndex.has(
      `${evidence.evidence_item_id}\n${evidence.canonical_uri}\n${evidence.content_hash}`,
    ));
  const checkable = claims.length;
  const supported = claims.filter((claim) => claim.classification === "supported").length;
  const partial = claims.filter((claim) => claim.classification === "partially_supported").length;
  const unsupported = claims.filter((claim) => claim.classification === "unsupported").length;
  const contradicted = claims.filter((claim) => claim.classification === "contradicted").length;
  const unverifiable = claims.filter((claim) => claim.classification === "unverifiable").length;
  const evidenceBackedSupported = claims.filter(
    (claim) => claim.classification === "supported" && validEvidence(claim).length > 0,
  ).length;
  const evidenceBackedPartial = claims.filter(
    (claim) => claim.classification === "partially_supported" && validEvidence(claim).length > 0,
  ).length;
  const citationCovered = claims.filter(
    (claim) => claim.citations.length > 0 && validEvidence(claim).length > 0,
  ).length;
  const citationCorrect = claims.filter(
    (claim) => claim.citations.length > 0
      && validEvidence(claim).length > 0
      && ["supported", "partially_supported"].includes(claim.classification),
  ).length;
  const citationSpecific = claims.filter(
    (claim) => validEvidence(claim).some((evidence) => isSpecificCitation(evidence.canonical_uri)),
  ).length;
  const unsupportedCritical = claims.filter(
    (claim) => claim.critical_kind && claim.classification !== "supported",
  );
  const fabricatedEntities = claims.flatMap((claim) => claim.fabricated_entities ?? []);
  const fabricatedQuantitative = claims.flatMap(
    (claim) => claim.fabricated_quantitative_details ?? [],
  );
  const attributionClaims = claims.filter(
    (claim) => claim.critical_kind === "ownership" || claim.critical_kind === "partner_or_customer",
  );
  const attributed = attributionClaims.filter(
    (claim) => claim.classification === "supported" && validEvidence(claim).length > 0,
  ).length;
  const confidence = ratio(
    claims.reduce((sum, claim) => sum + (claim.abstained ? 0 : claim.confidence), 0),
    checkable,
  );
  const grounding = ratio(supported + 0.5 * partial, checkable);
  const negativeClaimRate = (count: number): number => checkable > 0 ? count / checkable : 0;
  const linkCheck = internalLinkFindings(input.candidatePages, input.evidencePagePaths);
  const templateCheck = templateFindings(
    input.candidatePages,
    input.requiredTemplatePaths,
    input.requiredTemplates,
  );
  const deterministicStable = stablePreservation(
    input.candidatePages,
    input.liveStablePages ?? {},
  );
  const signals = input.signals ?? {};
  const stableSignal = {
    passed: deterministicStable.valid,
    total: deterministicStable.total,
    findings: deterministicStable.findings,
  };

  const byId: Record<TomeRubricId, RubricResult> = {
    atomic_claim_inventory: metric("atomic_claim_inventory", policy, {
      score: ratio(claims.length - invalidClaimSpans.length, claims.length),
      numerator: claims.length - invalidClaimSpans.length,
      denominator: claims.length,
      findings: invalidClaimSpans.map(
        (claim) => `${claim.page}: claim ${claim.id} has an invalid exact-text span.`,
      ),
    }),
    claim_evidence: metric("claim_evidence", policy, {
      score: ratio(evidenceBackedSupported + 0.5 * evidenceBackedPartial, checkable),
      numerator: evidenceBackedSupported + 0.5 * evidenceBackedPartial,
      denominator: checkable,
      findings: claims
        .filter((claim) => ["supported", "partially_supported"].includes(claim.classification)
          && validEvidence(claim).length === 0)
        .map((claim) => `${claim.page}: supported classification has no valid frozen evidence reference.`),
    }),
    citation_coverage: metric("citation_coverage", policy, {
      rate: ratio(citationCovered, checkable), numerator: citationCovered, denominator: checkable,
    }),
    citation_correctness: metric("citation_correctness", policy, {
      rate: ratio(citationCorrect, citationCovered), numerator: citationCorrect, denominator: citationCovered,
    }),
    citation_specificity: metric("citation_specificity", policy, {
      rate: ratio(citationSpecific, citationCovered), numerator: citationSpecific, denominator: citationCovered,
    }),
    grounding: metric("grounding", policy, {
      score: grounding, numerator: supported + 0.5 * partial, denominator: checkable,
    }),
    unsupported_claims: metric("unsupported_claims", policy, {
      count: unsupported, rate: negativeClaimRate(unsupported), numerator: unsupported, denominator: checkable,
    }),
    contradictions: metric("contradictions", policy, {
      count: contradicted, rate: negativeClaimRate(contradicted), numerator: contradicted, denominator: checkable,
    }),
    unverifiable_claims: metric("unverifiable_claims", policy, {
      count: unverifiable, rate: negativeClaimRate(unverifiable), numerator: unverifiable, denominator: checkable,
    }),
    unsupported_critical_claims: metric("unsupported_critical_claims", policy, {
      count: unsupportedCritical.length,
      findings: unsupportedCritical.map((claim) => `${claim.page}: ${claim.exact_text}`),
    }),
    fabricated_entities: metric("fabricated_entities", policy, {
      count: fabricatedEntities.length,
      findings: fabricatedEntities,
    }),
    fabricated_quantitative_details: metric("fabricated_quantitative_details", policy, {
      count: fabricatedQuantitative.length,
      findings: fabricatedQuantitative,
    }),
    explicit_gaps: signalMetric("explicit_gaps", policy, signals),
    semantic_fidelity: signalMetric("semantic_fidelity", policy, signals),
    conflict_disclosure: signalMetric("conflict_disclosure", policy, signals),
    source_freshness: signalMetric("source_freshness", policy, signals),
    material_coverage: signalMetric("material_coverage", policy, signals),
    scope_fidelity: signalMetric("scope_fidelity", policy, signals),
    stable_page_preservation: metric("stable_page_preservation", policy, {
      score: ratio(stableSignal.passed, stableSignal.total),
      numerator: stableSignal.passed,
      denominator: stableSignal.total,
      findings: stableSignal.findings,
    }),
    template_compliance: metric("template_compliance", policy, {
      score: ratio(templateCheck.valid, templateCheck.total),
      numerator: templateCheck.valid,
      denominator: templateCheck.total,
      findings: templateCheck.findings,
    }),
    internal_link_validity: metric("internal_link_validity", policy, {
      score: ratio(linkCheck.valid, linkCheck.total),
      numerator: linkCheck.valid,
      denominator: linkCheck.total,
      findings: linkCheck.findings,
    }),
    attribution_integrity: metric("attribution_integrity", policy, {
      score: ratio(attributed, attributionClaims.length),
      numerator: attributed,
      denominator: attributionClaims.length,
    }),
    evaluator_confidence: metric("evaluator_confidence", policy, {
      score: confidence,
      findings: claims.filter((claim) => claim.abstained).map((claim) => `${claim.page}: evaluator abstained on ${claim.exact_text}`),
    }),
    cost_efficiency: metric("cost_efficiency", policy, {
      score: (input.generationCostUsd ?? 0) + (input.evaluationCostUsd ?? 0),
    }),
    latency_efficiency: metric("latency_efficiency", policy, {
      score: (input.generationLatencyMs ?? 0) + (input.evaluationLatencyMs ?? 0),
    }),
  };
  return TOME_RUBRIC_IDS.map((id) => byId[id]);
}

export function qualityGateDecision(
  policy: QualityPolicy,
  evaluation: ArtifactEvaluation | null,
): QualityGateDecision {
  if (policy.mode === "off") {
    return { allowed: true, mode: "off", policy_version: policy.version, blockers: [], requires_override: false };
  }
  const blockers = evaluation
    ? evaluation.rubrics
        .filter((rubric) => rubric.enabled && rubric.blocking && rubric.passed !== true)
        .map((rubric) => rubric.id)
    : ["Evaluation is missing."];
  if (evaluation?.status === "error") blockers.unshift(evaluation.error || "Evaluation failed.");
  if (evaluation?.blocking_findings.length) blockers.push(...evaluation.blocking_findings);
  const enforced = policy.mode === "enforce";
  return {
    allowed: !enforced || blockers.length === 0,
    mode: policy.mode,
    policy_version: policy.version,
    blockers,
    requires_override: enforced && blockers.length > 0 && policy.allow_steward_override,
  };
}

export function canAutoPromoteOverdue(
  policy: QualityPolicy,
  evaluation: ArtifactEvaluation | null,
): boolean {
  if (policy.mode === "off") return true;
  if (policy.require_human_review) return false;
  return policy.mode !== "enforce" || qualityGateDecision(policy, evaluation).allowed;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function variance(values: number[]): number | null {
  const average = mean(values);
  return average === null ? null : mean(values.map((value) => (value - average) ** 2));
}

export function aggregateExperiment(
  experiment: TomeExperiment,
  artifacts: ExperimentArtifact[],
  evaluations: ArtifactEvaluation[],
): ExperimentAggregate[] {
  const scoreFor = (evaluation: ArtifactEvaluation): number =>
    mean(evaluation.rubrics.filter((rubric) =>
      rubric.passed !== null
      && rubric.score !== undefined
      && !["cost_efficiency", "latency_efficiency"].includes(rubric.id)
    ).map((rubric) => rubric.score!)) ?? 0;
  const validEvaluations = evaluations.filter((evaluation) => evaluation.status !== "error");
  const paired = new Map<number, Partial<Record<"a" | "b", number>>>();
  for (const artifact of artifacts) {
    const evaluation = validEvaluations.find((value) => value.artifact_id === artifact._id);
    if (!evaluation) continue;
    const row = paired.get(artifact.trial) ?? {};
    row[artifact.candidate] = scoreFor(evaluation);
    paired.set(artifact.trial, row);
  }
  return (["a", "b"] as const).map((candidate) => {
    const candidateArtifacts = artifacts.filter((artifact) => artifact.candidate === candidate);
    const allCandidateEvaluations = evaluations.filter((evaluation) =>
      candidateArtifacts.some((artifact) => artifact._id === evaluation.artifact_id),
    );
    const candidateEvaluations = allCandidateEvaluations.filter(
      (evaluation) => evaluation.status !== "error",
    );
    const scores = candidateEvaluations.map(scoreFor);
    let wins = 0;
    let ties = 0;
    let losses = 0;
    for (const pair of paired.values()) {
      if (pair.a === undefined || pair.b === undefined) continue;
      const delta = candidate === "a" ? pair.a - pair.b : pair.b - pair.a;
      if (Math.abs(delta) < 1e-9) ties += 1;
      else if (delta > 0) wins += 1;
      else losses += 1;
    }
    const absoluteScores: ExperimentAggregate["absolute_scores"] = {};
    for (const id of TOME_RUBRIC_IDS) {
      const values = candidateEvaluations
        .map((evaluation) => evaluation.rubrics.find((rubric) => rubric.id === id)?.score)
        .filter((value): value is number => value !== undefined);
      if (values.length) absoluteScores[id] = values;
    }
    const trialRows = experiment.trials.filter((trial) => trial.candidate === candidate);
    const generationCost = trialRows.reduce((sum, trial) => sum + (trial.cost_usd ?? 0), 0);
    const evaluationCost = allCandidateEvaluations.reduce(
      (sum, evaluation) => sum + (evaluation.evaluation_cost_usd ?? 0), 0,
    );
    const supportedClaims = candidateEvaluations.flatMap((evaluation) => evaluation.claims)
      .filter((claim) => claim.classification === "supported").length;
    return {
      experiment_id: experiment._id,
      candidate,
      absolute_scores: absoluteScores,
      pass_rate: candidateEvaluations.length > 0
        ? candidateEvaluations.filter((evaluation) => evaluation.status === "passed").length
          / candidateEvaluations.length
        : null,
      wins,
      ties,
      losses,
      mean_score: mean(scores),
      median_score: median(scores),
      variance: variance(scores),
      generation_cost_usd: generationCost,
      evaluation_cost_usd: evaluationCost,
      median_generation_latency_ms: median(trialRows.map((trial) => trial.generation_latency_ms).filter((value): value is number => value !== undefined)),
      median_evaluation_latency_ms: median(allCandidateEvaluations
        .map((evaluation) => evaluation.evaluation_latency_ms)
        .filter((value): value is number => value !== undefined)),
      cost_per_supported_claim: supportedClaims ? (generationCost + evaluationCost) / supportedClaims : null,
    };
  });
}

export const __test = { internalLinkFindings, isSpecificCitation, median, variance };
