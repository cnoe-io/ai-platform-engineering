/**
 * Contracts for TOME's grounded generation experiments and promotion gate.
 *
 * Experiment candidates are deliberately not PageRevisions. They live in
 * `tome_experiment_artifacts` until a human selects one for normal draft
 * review. Evidence and configuration records are immutable/versioned so an
 * old result can be reproduced without reading today's project state.
 */

import type { ModelProvenance } from "@/types/tome";
import type { ProjectType } from "@/types/projects";

export const TOME_RUBRIC_IDS = [
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
  "explicit_gaps",
  "semantic_fidelity",
  "conflict_disclosure",
  "source_freshness",
  "material_coverage",
  "scope_fidelity",
  "stable_page_preservation",
  "template_compliance",
  "internal_link_validity",
  "attribution_integrity",
  "evaluator_confidence",
  "cost_efficiency",
  "latency_efficiency",
] as const;

export type TomeRubricId = (typeof TOME_RUBRIC_IDS)[number];
export type QualityPolicyMode = "off" | "observe" | "enforce";
export type QualityPolicyScopeKind = "global" | "type" | "exact";
export type ClaimClassification =
  | "supported"
  | "partially_supported"
  | "unsupported"
  | "contradicted"
  | "unverifiable";
export type CriticalClaimKind =
  | "ownership"
  | "partner_or_customer"
  | "quantitative"
  | "date_or_deadline"
  | "commitment"
  | "project_status"
  | "security_or_compliance"
  | "financial";

export interface RubricThreshold {
  enabled: boolean;
  /** Minimum passing score/rate for positive metrics. */
  min?: number;
  /** Maximum passing count/rate for negative metrics. */
  max?: number;
  /** Optional explicit count bounds when a rubric reports both count and rate. */
  min_count?: number;
  max_count?: number;
  /** Optional explicit rate bounds when a rubric reports both count and rate. */
  min_rate?: number;
  max_rate?: number;
  /** A failed rubric with blocking=true prevents promotion in enforce mode. */
  blocking: boolean;
}

export type RubricPolicy = Record<TomeRubricId, RubricThreshold>;

export interface QualityPolicy {
  _id: string;
  scope_kind: QualityPolicyScopeKind;
  scope_id: string | null;
  version: number;
  mode: QualityPolicyMode;
  evaluator_model: string;
  rubrics: RubricPolicy;
  require_human_review: boolean;
  allow_steward_override: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface ResolvedQualityPolicy {
  policy: QualityPolicy;
  source: QualityPolicyScopeKind;
}

export type EvidenceKind =
  | "github"
  | "confluence"
  | "webex"
  | "wiki"
  | "template"
  | "seed"
  | "project_snapshot";

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  canonical_uri: string;
  content_hash: string;
  content: string;
  /** Original workspace path when this item is a frozen wiki/source page. */
  page_path?: string;
  /** Workspace owner for current/child pages in a synthesized experiment. */
  workspace_project_id?: string;
  captured_at: string;
  /** Optional source timestamp used by freshness checks. */
  source_updated_at?: string | null;
}

export interface EvidenceBundle {
  _id: string;
  project_id: string;
  project_slug: string;
  version: 1;
  content_hash: string;
  items: EvidenceItem[];
  created_at: string;
  created_by: string;
}

export type ExperimentOperation = "ingest" | "synthesize" | "compact";
export type ExperimentStatus =
  | "queued"
  | "running"
  | "evaluating"
  | "stopped_by_user"
  | "completed"
  | "stopped_cost_ceiling"
  | "failed";
export type ExperimentCandidate = "a" | "b";

export interface EvaluatorPromptContract {
  version: string;
  system_prompt: string;
  request_template: string;
  editable: false;
}

export interface ExperimentConfig {
  evaluation_suite_id: string;
  evaluation_suite_version: number;
  model_a: string;
  model_b: string;
  evaluator_model: string;
  operation: ExperimentOperation;
  entity_type: ProjectType;
  entity_id: string;
  repeat_count: number;
  cost_ceiling_usd: number;
  promotion_mode: "manual";
  rubric_policy: RubricPolicy;
  rubric_policy_version: number;
  rubric_policy_scope: QualityPolicyScopeKind;
  rubric_policy_scope_id: string | null;
  quality_policy_mode: QualityPolicyMode;
  require_human_review: boolean;
  allow_steward_override: boolean;
  prompt_hash: string;
  evaluator_prompt_contract?: EvaluatorPromptContract;
  tool_contract_version: string;
  template_versions: Record<string, number>;
  turn_limit: number;
  seed: number;
  instruction?: string | null;
}

export interface ExperimentTrial {
  trial: number;
  candidate: ExperimentCandidate;
  run_identity: string;
  artifact_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "not_started";
  model: string;
  model_provenance?: ModelProvenance;
  tokens?: { input: number; output: number };
  turns?: number;
  generation_latency_ms?: number;
  cost_usd?: number;
  error?: string;
}

export interface TomeExperiment {
  _id: string;
  project_id: string;
  project_slug: string;
  evidence_bundle_id: string;
  evidence_hash: string;
  config: ExperimentConfig;
  config_version: 1;
  status: ExperimentStatus;
  trials: ExperimentTrial[];
  selected_winner?: ExperimentCandidate;
  selected_artifact_id?: string;
  promoted_run_id?: string;
  created_at: string;
  created_by: string;
  started_at?: string;
  finished_at?: string;
  cancel_requested_at?: string;
  cancel_requested_by?: string;
  error?: string;
}

export interface ExperimentArtifactPage {
  path: string;
  markdown: string;
  content_hash: string;
  written_at: string;
}

export interface ExperimentArtifact {
  _id: string;
  experiment_id: string;
  project_id: string;
  trial: number;
  candidate: ExperimentCandidate;
  blind_label: string;
  model: string;
  run_identity: string;
  evidence_bundle_id: string;
  pages: ExperimentArtifactPage[];
  created_at: string;
  updated_at: string;
  finalized_at?: string;
}

export interface ClaimEvidenceReference {
  evidence_item_id: string;
  canonical_uri: string;
  content_hash: string;
  quote?: string;
}

export interface ClaimFinding {
  id: string;
  page: string;
  section: string | null;
  exact_text: string;
  start_offset: number;
  end_offset: number;
  classification: ClaimClassification;
  reason: string;
  confidence: number;
  abstained: boolean;
  citations: string[];
  evidence: ClaimEvidenceReference[];
  critical_kind?: CriticalClaimKind | null;
  fabricated_entities?: string[];
  fabricated_quantitative_details?: string[];
}

export interface RubricResult {
  id: TomeRubricId;
  enabled: boolean;
  passed: boolean | null;
  blocking: boolean;
  score?: number;
  count?: number;
  rate?: number;
  numerator?: number;
  denominator?: number;
  threshold?: {
    min?: number;
    max?: number;
    min_count?: number;
    max_count?: number;
    min_rate?: number;
    max_rate?: number;
  };
  findings: string[];
}

export interface ArtifactEvaluation {
  _id: string;
  experiment_id: string;
  artifact_id: string;
  blind_label: string;
  evaluator_model: string;
  evaluator_is_candidate: boolean;
  status: "passed" | "failed" | "error";
  claims: ClaimFinding[];
  rubrics: RubricResult[];
  blocking_findings: string[];
  evaluation_tokens?: { input: number; output: number };
  evaluation_turns?: number;
  evaluation_latency_ms?: number;
  evaluation_cost_usd?: number;
  created_at: string;
  error?: string;
}

export interface ExperimentAggregate {
  experiment_id: string;
  candidate: ExperimentCandidate;
  absolute_scores: Partial<Record<TomeRubricId, number[]>>;
  pass_rate: number | null;
  wins: number;
  ties: number;
  losses: number;
  mean_score: number | null;
  median_score: number | null;
  variance: number | null;
  generation_cost_usd: number;
  evaluation_cost_usd: number;
  median_generation_latency_ms: number | null;
  median_evaluation_latency_ms: number | null;
  cost_per_supported_claim: number | null;
}

export interface QualityGateDecision {
  allowed: boolean;
  mode: QualityPolicyMode;
  policy_version: number | null;
  blockers: string[];
  requires_override: boolean;
}

export interface QualityGateOverride {
  _id: string;
  run_id: string;
  project_id: string;
  policy_version: number;
  actor: string;
  reason: string;
  failed_rubrics: TomeRubricId[];
  created_at: string;
}
