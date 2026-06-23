/**
 * Shared TypeScript types for the Agentic SDLC feature.
 *
 * These mirror the entity definitions in
 * docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/data-model.md.
 *
 * Stay snake_case for stored fields to match existing collections in
 * ui/src/lib/mongodb.ts.
 */

import type { ObjectId } from "mongodb";

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export type AgenticSdlcStage =
  | "specify"
  | "plan"
  | "tasks"
  | "implement"
  | "unit_test"
  | "review_hitl"
  | "merge"
  | "deploy"
  | "validate"
  | "observe"
  | "blocked"
  | "unknown";

export const AGENTIC_SDLC_STAGES: AgenticSdlcStage[] = [
  "specify",
  "plan",
  "tasks",
  "implement",
  "unit_test",
  "review_hitl",
  "merge",
  "deploy",
  "validate",
  "observe",
  "blocked",
  "unknown",
];

/**
 * Default agent label vocabulary. Per-repo overrides land in
 * `OnboardedRepo.label_to_stage_overrides` and take precedence.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */
export const DEFAULT_AGENT_LABEL_TO_STAGE: Record<string, AgenticSdlcStage> = {
  "agent:specify": "specify",
  "agent:plan": "plan",
  "agent:tasks": "tasks",
  "agent:implement": "implement",
  "agent:unit-test": "unit_test",
  "agent:test": "unit_test",
  "agent:awaiting-review": "review_hitl",
  "agent:deploy-sandbox": "deploy",
  "agent:validate": "validate",
  "agent:e2e-test": "validate",
  "agent:observe": "observe",
  "agent:blocked": "blocked",
  "agent:paused": "blocked",

  // Real repo operating taxonomy used by onboarded repositories.
  "agent:architect": "plan",
  "agent:coder": "implement",
  "agent:reviewer": "review_hitl",
  "agent:tester": "unit_test",
  "agent:deployer": "deploy",
  "agent:deep-think": "plan",
  "status:ready": "tasks",
  "status:in-progress": "implement",
  "status:blocked": "blocked",
  "status:needs-review": "review_hitl",
  "status:needs-test": "unit_test",
  "status:done": "observe",
  "needs:arthur": "blocked",
  "needs:decision": "blocked",
  "needs:repo-access": "blocked",
};

// ---------------------------------------------------------------------------
// Webhook health
// ---------------------------------------------------------------------------

export type WebhookHealthStatus =
  | "healthy"
  | "degraded"
  | "missing"
  | "unknown";

// ---------------------------------------------------------------------------
// OnboardedRepo
// ---------------------------------------------------------------------------

export interface OnboardedRepo {
  _id?: ObjectId;
  repo_id: string;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  sandbox_environment: string;
  webhook_id: number | null;
  webhook_secret_hash: string;
  webhook_status: WebhookHealthStatus;
  webhook_last_event_at: Date | null;
  last_reconciled_at?: Date | null;
  label_to_stage_overrides: Record<string, AgenticSdlcStage>;
  onboarded_by_user_id: string;
  onboarded_at: Date;
  offboarded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// AgenticSdlcEvent
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | "epic"
  | "subtask"
  | "pull_request"
  | "deploy"
  | "comment"
  | "review"
  | "label"
  | "unknown";

export type ActorKind = "agent" | "human" | "system";

export type ProjectionStatus = "projected" | "deferred" | "failed";

export interface AgenticSdlcEvent {
  _id?: ObjectId;
  repo_id: string;
  source: "github" | "ui";
  github_delivery_id: string | null;
  github_event_type: string | null;
  github_action: string | null;
  artifact_kind: ArtifactKind;
  artifact_id: string;
  epic_id: string | null;
  actor_kind: ActorKind;
  actor_login: string | null;
  payload: Record<string, unknown>;
  delivered_at: Date;
  occurred_at: Date;
  projection_status: ProjectionStatus;
  projection_attempts: number;
}

// ---------------------------------------------------------------------------
// AgenticSdlcArtifact (derived state)
// ---------------------------------------------------------------------------

export type ArtifactKindStored =
  | "epic"
  | "subtask"
  | "pull_request"
  | "deploy";

export type ArtifactNativeState =
  | "open"
  | "closed"
  | "merged"
  | "in_progress"
  | "success"
  | "failure"
  | "cancelled"
  | "unknown";

export interface AgenticSdlcArtifact {
  _id?: ObjectId;
  repo_id: string;
  kind: ArtifactKindStored;
  artifact_id: string;
  epic_id: string | null;
  parent_subtask_id: string | null;
  title: string;
  body_excerpt: string;
  state: ArtifactNativeState;
  current_stage: AgenticSdlcStage;
  assignees: string[];
  requested_reviewers: string[];
  labels: string[];
  agent_labels: string[];
  needs_human: boolean;
  stalled_since: Date | null;
  last_event_at: Date;
  github_url: string;
  created_at: Date;
  updated_at: Date;
  /**
   * Latest CI summary for this artifact, populated when `check_run`,
   * `check_suite`, or `workflow_run` events have been projected. Optional
   * so existing artifacts that pre-date CI projection remain valid.
   */
  ci_summary?: ArtifactCiSummary | null;
  /**
   * Head SHA (PRs only) — captured at projection time and used by the CI
   * panel to group checks across multiple commits on the same PR.
   */
  head_sha?: string | null;
}

// ---------------------------------------------------------------------------
// HITL action payload (UI events)
// ---------------------------------------------------------------------------

export type HitlActionKind =
  | "approve_pr"
  | "request_changes"
  | "comment"
  | "retry_deploy"
  | "pause_loop"
  | "resume_loop";

export interface HitlActionPayload {
  action: HitlActionKind;
  target_artifact_id: string;
  comment?: string;
  outcome?: "ok" | "error";
  error_message?: string;
}

// ---------------------------------------------------------------------------
// Velocity + agent run records
// ---------------------------------------------------------------------------

export interface VelocityWindow {
  /** ISO start, inclusive */
  start: string;
  /** ISO end, exclusive */
  end: string;
  label: "7d" | "30d" | "90d";
}

export interface VelocityMetric {
  scope: "repo" | "team";
  scope_id: string;
  window: VelocityWindow;
  epics_merged: number;
  median_time_in_stage_seconds: Partial<Record<AgenticSdlcStage, number>>;
  agent_pr_count: number;
  human_pr_count: number;
  median_hitl_queue_age_seconds: number | null;
  /** Total agent token spend in this scope/window (null when telemetry incomplete). */
  agent_tokens_total: number | null;
  agent_tokens_prompt: number | null;
  agent_tokens_completion: number | null;
  /** Per-model breakdown (model id → token counts). */
  agent_tokens_by_model: Record<
    string,
    { prompt: number; completion: number; total: number }
  > | null;
  /**
   * Estimated agent $-spend in USD. Server strips this field when the
   * caller fails `requireRepoAdmin`.
   */
  cost_usd: number | null;
  /**
   * `incomplete` = one or more inputs to this metric had gaps in the
   * window (e.g. event log retention or Langfuse outage). UI surfaces a
   * banner.
   */
  completeness: "complete" | "incomplete";
}

export interface AgentRunRecord {
  /** Run id from CAIPE Dynamic Agent or the supervisor session. */
  run_id: string;
  /** Best-effort link back to the Epic this run was working on. */
  epic_id: string | null;
  repo_id: string;
  agent_login: string;
  started_at: Date;
  ended_at: Date | null;
  /** Langfuse trace id, when available. */
  langfuse_trace_id: string | null;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  model_id: string;
  cost_usd: number | null;
}

// ---------------------------------------------------------------------------
// CI status (check_run / check_suite projection)
// ---------------------------------------------------------------------------

/**
 * Normalised CI conclusion across `check_run`, `check_suite`, and GitHub
 * Actions `workflow_run`. We collapse the GitHub vocabulary
 * (success | failure | timed_out | action_required | neutral | cancelled
 *  | skipped | stale | startup_failure | null) into a small, UI-friendly
 * set so panels can render a single tone (success / failure / pending).
 */
export type CiConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "timed_out"
  | "skipped"
  | "action_required"
  | "stale"
  | "pending"
  | "unknown";

export type CiStatus = "queued" | "in_progress" | "completed";

/**
 * Latest CI status for a single PR or task that is still "in flight".
 *
 * One row per (artifact_id, check_name). We keep only the latest run
 * per check name on each artifact -- old runs are replaced on each
 * webhook delivery.
 *
 * Stored summary lives on the artifact row itself (see
 * `AgenticSdlcArtifact.ci_summary`), and the per-check detail is
 * derived on demand from `ship_loop_events` (no separate collection
 * for the MVP).
 */
export interface CiCheckRun {
  artifact_id: string;
  repo_id: string;
  check_name: string;
  /** Identifier of the underlying check_run / workflow_run. */
  external_id: string;
  status: CiStatus;
  conclusion: CiConclusion;
  /** GitHub-supplied details URL, or `null` if not provided. */
  details_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  /** Pull-request head SHA when available; used to align checks per PR. */
  head_sha: string | null;
}

/**
 * Summary embedded on a `pull_request` or `subtask` artifact when CI
 * events have arrived for it. Lets the UI render the badge without
 * scanning the events collection.
 */
export interface ArtifactCiSummary {
  /** Aggregate conclusion across non-skipped checks for this artifact. */
  conclusion: CiConclusion;
  /** Aggregate status: in_progress wins over completed when any check still runs. */
  status: CiStatus;
  /** Counts by conclusion (success/failure/pending/...). */
  by_conclusion: Partial<Record<CiConclusion, number>>;
  /** Total distinct check names seen on this artifact. */
  total: number;
  /** Most recent check completion (or start) timestamp seen. */
  last_event_at: string;
}

// ---------------------------------------------------------------------------
// Changelog (completed-feature) entries
// ---------------------------------------------------------------------------

export type ChangelogEntryKind =
  | "epic_merged"
  | "epic_closed"
  | "pull_request_merged"
  | "deploy_succeeded";

export interface ChangelogEntry {
  id: string;
  kind: ChangelogEntryKind;
  title: string;
  body_excerpt: string;
  /** ISO timestamp when the artifact transitioned into its done state. */
  completed_at: string;
  github_url: string;
  /** Linked epic id when known, else `null`. */
  epic_id: string | null;
  /** Agent or human persona that closed the item, if derivable. */
  actor_label: string | null;
  actor_kind: ActorKind;
  /** Labels at completion time (used for tagging in the UI). */
  labels: string[];
}

// ---------------------------------------------------------------------------
// Build / snapshot artifacts (GitHub Actions + deploys)
// ---------------------------------------------------------------------------

export type SnapshotArtifactKind =
  | "github_actions_artifact"
  | "deploy_snapshot"
  | "agentic_artifact";

export interface SnapshotArtifactRecord {
  id: string;
  kind: SnapshotArtifactKind;
  /** Human title (workflow name, artifact name, deploy environment, or epic title). */
  title: string;
  /** Optional secondary line (workflow run name, deploy state, artifact size). */
  subtitle: string | null;
  /** When the artifact was produced or last updated. */
  produced_at: string;
  /** Best-effort link out to GitHub / the underlying artifact. */
  url: string | null;
  /** Optional size in bytes for GitHub Actions artifacts. */
  size_bytes: number | null;
  /** Tone hint for the UI: success/failure/neutral. */
  tone: "success" | "failure" | "neutral";
  /** Source run / event identifier so the UI can dedupe. */
  source_run_id: string | null;
}

// ---------------------------------------------------------------------------
// Deployment health
// ---------------------------------------------------------------------------

export type DeploymentEnvironmentHealth =
  | "healthy"
  | "degraded"
  | "failing"
  | "idle"
  | "unknown";

export interface DeploymentRecord {
  id: string;
  environment: string;
  state: ArtifactNativeState;
  /** Free-text description from the latest deployment_status payload. */
  description: string | null;
  started_at: string | null;
  completed_at: string | null;
  /**
   * Duration in seconds if both started_at and completed_at are present.
   */
  duration_seconds: number | null;
  /** Failure reason extracted from the description / target_url when state is failure. */
  failure_reason: string | null;
  url: string | null;
  /** Optional linked epic id for traceability. */
  epic_id: string | null;
}

export interface DeploymentEnvironmentSummary {
  environment: string;
  health: DeploymentEnvironmentHealth;
  /** Last deploy that completed (success or failure), if any. */
  last_deploy_at: string | null;
  /** Success rate across the window, as a 0..1 float. */
  success_rate: number;
  /** Failure count in the window. */
  failure_count: number;
  /** Success count in the window. */
  success_count: number;
  /** Median duration in seconds of completed deploys in the window. */
  median_duration_seconds: number | null;
  /** MTTR-ish: median seconds between a failure and the next success. */
  median_recovery_seconds: number | null;
  /** Most recent N deploys, newest first. */
  recent_deploys: DeploymentRecord[];
}

export interface DeploymentHealthSummary {
  /** Lookback window (hours) used to compute the summary. */
  window_hours: number;
  /** All environments with recent activity in the window. */
  environments: DeploymentEnvironmentSummary[];
  /** Aggregate counts across all environments. */
  totals: {
    success: number;
    failure: number;
    in_progress: number;
  };
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Spec health, intent drift, harness, mistakes, budget, fan-out, provenance,
// blast radius, rollback, prod signals, failure modes, blackbox
// ---------------------------------------------------------------------------

// Each section below mirrors a panel in panel-registry.ts. Kept here so
// every consumer (projector + API + client component) shares one type.

export type SpecCriterionKind =
  | "acceptance_criteria"
  | "non_functional_requirements"
  | "architectural_constraints"
  | "test_strategy"
  | "budget"
  | "adr_link";

export interface SpecCriterionStatus {
  kind: SpecCriterionKind;
  label: string;
  present: boolean;
  hint?: string;
}

export interface SpecHealthEpicScore {
  epic_id: string;
  title: string;
  github_url: string;
  score: number; // 0..100
  band: "weak" | "fair" | "good" | "strong";
  criteria: SpecCriterionStatus[];
  last_event_at: string;
}

export interface SpecHealthSummary {
  repo_score: number; // weighted average across epics
  epics: SpecHealthEpicScore[];
  generated_at: string;
}

export interface IntentDriftEpicScore {
  epic_id: string;
  title: string;
  github_url: string;
  /** 0..1 — fraction of PR work that maps to AC tokens. */
  alignment: number;
  /** PRs counted toward this epic. */
  pr_count: number;
  /** Drift beads, oldest to newest. Each bead is amplitude 0..1. */
  beads: number[];
}

export interface IntentDriftSummary {
  epics: IntentDriftEpicScore[];
  generated_at: string;
}

export type HarnessRuleKind =
  | "lint"
  | "structural_test"
  | "adr"
  | "skill"
  | "policy"
  | "security_scan";

export interface HarnessRule {
  id: string;
  kind: HarnessRuleKind;
  name: string;
  source: string; // file path or URL
  last_violation_at: string | null;
  last_violation_summary: string | null;
  pass_rate: number; // 0..1 across recent runs
  coverage_gap?: string | null;
}

export interface HarnessSummary {
  totals: {
    lint: number;
    structural: number;
    adr: number;
    skill: number;
    policy: number;
    security: number;
  };
  pass_rate: number;
  rules: HarnessRule[];
  generated_at: string;
}

export interface HarnessLearning {
  id: string;
  occurred_at: string;
  rule_added: string;
  triggered_by: string; // PR # or commit ref
  agent: string | null;
  description: string;
  kind: HarnessRuleKind;
}

export interface MistakeEncodedSummary {
  learnings_24h: number;
  total_learnings: number;
  events: HarnessLearning[];
  generated_at: string;
}

export interface AgentRosterEntry {
  agent_id: string;
  role: "planner" | "coder" | "reviewer" | "tester" | "deployer" | "other";
  display_name: string;
  status: "idle" | "active" | "blocked";
  model: string | null;
  current_artifact_id: string | null;
  current_artifact_title: string | null;
  current_stage: AgenticSdlcStage | null;
  time_on_task_seconds: number;
  last_heartbeat_at: string;
}

export interface AgentRosterSummary {
  agents: AgentRosterEntry[];
  generated_at: string;
}

/**
 * Agent budget — measured in LLM tokens (millions) per epic / task,
 * not hours. This is the unit that maps directly to spend with OpenAI,
 * Anthropic, etc. and to context-window engineering decisions.
 *
 *   compute_tokens_m: tokens spent by builder agents producing code,
 *                     plans, and tool calls (prompt + completion).
 *   review_tokens_m:  tokens spent by reviewer/verifier agents on
 *                     analysis, diffs, and policy checks before merge.
 *
 * Numbers are stored as decimal millions (e.g. 4.7 means 4.7M tokens).
 */
export interface AgentBudgetEntry {
  epic_id: string;
  title: string;
  estimated_compute_tokens_m: number;
  actual_compute_tokens_m: number;
  estimated_review_tokens_m: number;
  actual_review_tokens_m: number;
  status: "on_track" | "warning" | "over";
}

export interface AgentBudgetSummary {
  totals: {
    estimated_compute_tokens_m: number;
    actual_compute_tokens_m: number;
    estimated_review_tokens_m: number;
    actual_review_tokens_m: number;
  };
  epics: AgentBudgetEntry[];
  generated_at: string;
}

export interface FanoutBranch {
  branch_id: string;
  agent: string;
  status: "in_progress" | "merged" | "abandoned";
  pr_url: string | null;
}

export interface FanoutEpic {
  epic_id: string;
  title: string;
  github_url: string;
  branches: FanoutBranch[];
  converges_at: string | null;
}

export interface FanoutSummary {
  epics: FanoutEpic[];
  generated_at: string;
}

export type VerifierBand = "weak" | "fair" | "good" | "strong";

export interface VerifierConfidenceEntry {
  artifact_id: string;
  title: string;
  github_url: string;
  coverage: number; // 0..1
  band: VerifierBand;
  acceptance_criteria_total: number;
  acceptance_criteria_covered: number;
}

export interface VerifierConfidenceSummary {
  median_coverage: number;
  entries: VerifierConfidenceEntry[];
  generated_at: string;
}

export type QualityGate =
  | "lint"
  | "unit"
  | "integration"
  | "sca"
  | "security"
  | "policy"
  | "architecture"
  | "human_review";

export type QualityGateState = "passed" | "failed" | "pending" | "skipped";

export interface QualityGateRun {
  artifact_id: string;
  title: string;
  github_url: string;
  current_gate: QualityGate;
  gates: { gate: QualityGate; state: QualityGateState; details?: string | null }[];
  conclusion: "passed" | "failed" | "running";
}

export interface QualityGauntletSummary {
  runs: QualityGateRun[];
  generated_at: string;
}

export type FailureModeKind =
  | "spec_ambiguity"
  | "hallucinated_dependency"
  | "test_gap"
  | "policy_violation"
  | "over_scoped_change"
  | "flaky_check"
  | "merge_conflict"
  | "unknown";

export interface FailureModeBucket {
  kind: FailureModeKind;
  label: string;
  count: number;
  share: number; // 0..1
  sample_artifact_ids: string[];
}

export interface FailureModesSummary {
  total: number;
  buckets: FailureModeBucket[];
  window_days: number;
  generated_at: string;
}

export interface ProvenanceRecord {
  artifact_id: string;
  title: string;
  github_url: string;
  model: string;
  harness_version: string;
  sbom_hash: string | null;
  signed: boolean;
  slsa_level: 0 | 1 | 2 | 3 | 4;
  reaudit_due_in_days: number | null;
  generated_at: string;
}

export interface ProvenanceSummary {
  signed_count: number;
  unsigned_count: number;
  reaudit_due_count: number;
  records: ProvenanceRecord[];
  generated_at: string;
}

export interface BlastRadiusReport {
  artifact_id: string;
  title: string;
  github_url: string;
  service_count: number;
  database_count: number;
  endpoint_count: number;
  blast_percent: number; // 0..100
  paths: string[]; // top file paths touched
}

export interface BlastRadiusSummary {
  reports: BlastRadiusReport[];
  generated_at: string;
}

export interface RollbackRehearsalEntry {
  environment: string;
  last_exercised_at: string | null;
  rehearsal_kind: "real" | "synthetic" | "never";
  status: "fresh" | "stale" | "missing";
}

export interface RollbackRehearsalSummary {
  entries: RollbackRehearsalEntry[];
  generated_at: string;
}

export type ProdSignalSeverity = "info" | "warning" | "critical";

export interface ProdSignalEvent {
  id: string;
  source: "sentry" | "datadog" | "tickets" | "custom";
  severity: ProdSignalSeverity;
  title: string;
  body: string | null;
  detected_at: string;
  proposed_epic_title: string | null;
  related_artifact_id: string | null;
}

export interface ProdSignalSummary {
  events: ProdSignalEvent[];
  generated_at: string;
}

export interface PrProdMetricSeries {
  artifact_id: string;
  title: string;
  github_url: string;
  metric: "latency_ms" | "error_rate" | "cost_usd";
  values: number[]; // 24 hourly samples
  delta_percent: number; // vs same window before the merge
}

export interface PrProdMetricSummary {
  prs: PrProdMetricSeries[];
  generated_at: string;
}

export interface BlackboxAuditEntry {
  artifact_id: string;
  title: string;
  github_url: string;
  human_lines: number;
  agent_lines: number;
  mixed_lines: number;
  agent_share: number; // 0..1
  last_reaudit_at: string | null;
  reaudit_overdue: boolean;
}

export interface BlackboxAuditSummary {
  total_agent_lines: number;
  total_human_lines: number;
  overdue_count: number;
  entries: BlackboxAuditEntry[];
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Collection name constants (single source of truth)
// ---------------------------------------------------------------------------

export const AGENTIC_SDLC_COLLECTIONS = {
  REPOS: "ship_loop_repos",
  EVENTS: "ship_loop_events",
  ARTIFACTS: "ship_loop_artifacts",
} as const;
