/**
 * Pure stage resolver for the Agentic SDLC Ship Loop.
 *
 * `resolveStage(input) → ShipLoopStage`
 *
 * Per data-model.md "Stage resolution rules", in order of precedence
 * (highest first):
 *
 *   1. Native GitHub terminal states  — merged PR + sandbox deploy_status
 *      success ⇒ `deploy` (or `observe` if a follow-up "verified" signal
 *      is present); deployment_status `failure` ⇒ `blocked`.
 *   2. Agent labels (configurable prefix) — `agent:specify` → `specify`
 *      etc. Per-repo `label_to_stage_overrides` apply BEFORE the default
 *      vocabulary so teams can use their own label words.
 *   3. Native PR review state — open PR with requested_reviewers and no
 *      agent stage label ⇒ `review_hitl`.
 *   4. Default — `unknown` (UI bucket: "Unstaged"; never silently dropped).
 *
 * IMPORTANT: this module is pure — no I/O, no env, no network. It can
 * therefore be tested exhaustively in jest without any setup.
 */

import {
  DEFAULT_AGENT_LABEL_TO_STAGE,
  type ArtifactNativeState,
  type ShipLoopStage,
} from "@/types/ship-loop";

export interface ResolveStageInput {
  /** Native GitHub state of the artifact (PR/issue/deploy). */
  githubState: ArtifactNativeState;
  /** All current labels on the artifact. */
  labels: string[];
  /** Per-repo overrides on top of DEFAULT_AGENT_LABEL_TO_STAGE. */
  labelOverrides?: Record<string, ShipLoopStage>;
  /** Latest deployment_status state for the configured sandbox env. */
  sandboxDeploymentState?:
    | "success"
    | "failure"
    | "error"
    | "in_progress"
    | "queued"
    | "pending"
    | "inactive"
    | null;
  /** True if a non-empty `requested_reviewers` is present (PR only). */
  hasRequestedReviewers?: boolean;
  /**
   * True if the artifact has been verified post-deploy (e.g. an
   * `agent:observe` label or an explicit "verified" signal). Drives
   * the deploy → observe transition.
   */
  observedSignal?: boolean;
}

const AGENT_LABEL_PREFIX = "agent:";

/** Pure resolver. */
export function resolveStage(input: ResolveStageInput): ShipLoopStage {
  // Rule 1 — native terminal states
  if (input.githubState === "merged") {
    if (input.sandboxDeploymentState === "success") {
      return input.observedSignal ? "observe" : "deploy";
    }
    if (
      input.sandboxDeploymentState === "failure" ||
      input.sandboxDeploymentState === "error"
    ) {
      return "blocked";
    }
    return "merge";
  }
  if (
    input.githubState === "failure" &&
    input.sandboxDeploymentState !== "success"
  ) {
    return "blocked";
  }

  // Rule 2 — labels (overrides first; both maps must be checked because
  // override entries can use any vocabulary, including non-`agent:` strings).
  const merged: Record<string, ShipLoopStage> = {
    ...DEFAULT_AGENT_LABEL_TO_STAGE,
    ...(input.labelOverrides ?? {}),
  };
  // First pass: highest-priority label wins. The lookup order below
  // mirrors a coarse "later in the loop wins" rule so that an artifact
  // tagged both `agent:implement` and `agent:awaiting-review` is shown
  // in review.
  const labelStagePriority: ShipLoopStage[] = [
    "blocked",
    "observe",
    "deploy",
    "merge",
    "review_hitl",
    "implement",
    "tasks",
    "plan",
    "specify",
  ];
  const labeledStages = new Set<ShipLoopStage>();
  for (const label of input.labels) {
    const stage = merged[label];
    if (stage) labeledStages.add(stage);
  }
  for (const stage of labelStagePriority) {
    if (labeledStages.has(stage)) return stage;
  }

  // Rule 3 — open PR with requested reviewers, no agent stage label
  if (
    input.githubState === "open" &&
    input.hasRequestedReviewers === true
  ) {
    return "review_hitl";
  }

  // Rule 4 — default
  return "unknown";
}

/**
 * Helper: derive `needs_human` from a stage + the artifact's reviewers.
 * Centralised here so the projector and the SSE handler agree.
 */
export function deriveNeedsHuman(
  stage: ShipLoopStage,
  hasRequestedReviewers: boolean,
): boolean {
  if (stage === "review_hitl" && hasRequestedReviewers) return true;
  if (stage === "blocked") return true;
  return false;
}

/** Test convenience: re-export the default vocab + the prefix. */
export const _internal = {
  AGENT_LABEL_PREFIX,
  DEFAULT_AGENT_LABEL_TO_STAGE,
};
