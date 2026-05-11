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
// Collection name constants (single source of truth)
// ---------------------------------------------------------------------------

export const AGENTIC_SDLC_COLLECTIONS = {
  REPOS: "ship_loop_repos",
  EVENTS: "ship_loop_events",
  ARTIFACTS: "ship_loop_artifacts",
} as const;
