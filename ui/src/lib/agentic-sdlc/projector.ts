/**
 * Pure projection: GitHub event payload + repo overrides → artifact patch.
 *
 * Extracted from async-worker.ts so unit tests can exercise it without
 * pulling in the Mongo driver transitive dependency.
 *
 * No I/O, no env, no network.
 */

import { resolveStage, deriveNeedsHuman } from "@/lib/agentic-sdlc/stage-resolver";
import type {
  ArtifactKindStored,
  ArtifactNativeState,
  OnboardedRepo,
  AgenticSdlcArtifact,
  AgenticSdlcEvent,
  AgenticSdlcStage,
} from "@/types/agentic-sdlc";

export type ArtifactPatch = Pick<
  AgenticSdlcArtifact,
  | "repo_id"
  | "kind"
  | "artifact_id"
  | "epic_id"
  | "parent_subtask_id"
  | "title"
  | "body_excerpt"
  | "state"
  | "current_stage"
  | "assignees"
  | "requested_reviewers"
  | "labels"
  | "agent_labels"
  | "needs_human"
  | "stalled_since"
  | "github_url"
> & { last_event_at: Date };

export function projectEvent(
  ev: AgenticSdlcEvent,
  repo: OnboardedRepo,
): ArtifactPatch | null {
  switch (ev.github_event_type) {
    case "pull_request":
      return projectPullRequest(ev, repo);
    case "issues":
      return projectIssue(ev, repo);
    case "deployment_status":
      return projectDeploymentStatus(ev, repo);
    case "sub_issues":
      return projectSubIssue(ev, repo);
    case "pull_request_review":
      return null;
    default:
      return null;
  }
}

function projectPullRequest(
  ev: AgenticSdlcEvent,
  repo: OnboardedRepo,
): ArtifactPatch | null {
  const pr = (ev.payload as { pull_request?: Record<string, unknown> }).pull_request;
  if (!pr) return null;

  const labels = ((pr.labels as { name?: string }[]) ?? [])
    .map((l) => l.name)
    .filter((n): n is string => typeof n === "string");
  const requestedReviewers = (
    (pr.requested_reviewers as { login?: string }[]) ?? []
  )
    .map((r) => r.login)
    .filter((l): l is string => typeof l === "string");
  const assignees = ((pr.assignees as { login?: string }[]) ?? [])
    .map((a) => a.login)
    .filter((l): l is string => typeof l === "string");
  const merged = pr.merged === true;
  const state = (
    merged ? "merged" : (pr.state as string) === "open" ? "open" : "closed"
  ) as ArtifactNativeState;

  const stage = resolveStage({
    githubState: state,
    labels,
    labelOverrides: repo.label_to_stage_overrides,
    hasRequestedReviewers: requestedReviewers.length > 0,
  });

  const agentLabels = labels.filter((l) => l.startsWith("agent:"));

  return {
    repo_id: ev.repo_id,
    kind: "pull_request",
    artifact_id: ev.artifact_id,
    epic_id: ev.epic_id,
    parent_subtask_id: null,
    title: typeof pr.title === "string" ? pr.title.slice(0, 500) : "",
    body_excerpt: typeof pr.body === "string" ? pr.body.slice(0, 1_000) : "",
    state,
    current_stage: stage,
    assignees,
    requested_reviewers: requestedReviewers,
    labels,
    agent_labels: agentLabels,
    needs_human: deriveNeedsHuman(stage, requestedReviewers.length > 0),
    stalled_since: null,
    github_url: (pr.html_url as string | undefined) ?? "",
    last_event_at: ev.occurred_at,
  };
}

function projectIssue(
  ev: AgenticSdlcEvent,
  repo: OnboardedRepo,
): ArtifactPatch | null {
  const issue = (ev.payload as { issue?: Record<string, unknown> }).issue;
  if (!issue) return null;
  const labels = ((issue.labels as { name?: string }[]) ?? [])
    .map((l) => l.name)
    .filter((n): n is string => typeof n === "string");
  const assignees = ((issue.assignees as { login?: string }[]) ?? [])
    .map((a) => a.login)
    .filter((l): l is string => typeof l === "string");
  const state = (issue.state as string) === "open" ? "open" : "closed";

  const stage = resolveStage({
    githubState: state as ArtifactNativeState,
    labels,
    labelOverrides: repo.label_to_stage_overrides,
  });
  const agentLabels = labels.filter((l) => l.startsWith("agent:"));

  const isEpic = labels.some((l) => l === "epic" || l === "Epic") ||
    (labels.includes("agent:specify") && !ev.epic_id);
  const kind: ArtifactKindStored = isEpic ? "epic" : "subtask";

  return {
    repo_id: ev.repo_id,
    kind,
    artifact_id: ev.artifact_id,
    epic_id: kind === "epic" ? null : ev.epic_id,
    parent_subtask_id: null,
    title: typeof issue.title === "string" ? issue.title.slice(0, 500) : "",
    body_excerpt: typeof issue.body === "string" ? issue.body.slice(0, 1_000) : "",
    state: state as ArtifactNativeState,
    current_stage: stage,
    assignees,
    requested_reviewers: [],
    labels,
    agent_labels: agentLabels,
    needs_human: deriveNeedsHuman(stage, false),
    stalled_since: null,
    github_url: (issue.html_url as string | undefined) ?? "",
    last_event_at: ev.occurred_at,
  };
}

function projectSubIssue(
  ev: AgenticSdlcEvent,
  repo: OnboardedRepo,
): ArtifactPatch | null {
  const { parentIssue, subIssue } = readSubIssuePayload(ev.payload);
  if (!subIssue || !parentIssue?.node_id) return null;

  const labels = ((subIssue.labels as { name?: string }[]) ?? [])
    .map((l) => l.name)
    .filter((n): n is string => typeof n === "string");
  const assignees = ((subIssue.assignees as { login?: string }[]) ?? [])
    .map((a) => a.login)
    .filter((l): l is string => typeof l === "string");
  const state = (subIssue.state as string) === "open" ? "open" : "closed";
  const stage = resolveStage({
    githubState: state as ArtifactNativeState,
    labels,
    labelOverrides: repo.label_to_stage_overrides,
  });
  const agentLabels = labels.filter((l) => l.startsWith("agent:"));

  return {
    repo_id: ev.repo_id,
    kind: "subtask",
    artifact_id: (subIssue.node_id as string | undefined) ?? ev.artifact_id,
    epic_id: parentIssue.node_id as string,
    parent_subtask_id: null,
    title: typeof subIssue.title === "string" ? subIssue.title.slice(0, 500) : "",
    body_excerpt:
      typeof subIssue.body === "string" ? subIssue.body.slice(0, 1_000) : "",
    state: state as ArtifactNativeState,
    current_stage: stage,
    assignees,
    requested_reviewers: [],
    labels,
    agent_labels: agentLabels,
    needs_human: deriveNeedsHuman(stage, false),
    stalled_since: null,
    github_url: (subIssue.html_url as string | undefined) ?? "",
    last_event_at: ev.occurred_at,
  };
}

/**
 * Build the Mongo upsert document for a `AgenticSdlcArtifact`.
 *
 * Critical invariant: `$set` and `$setOnInsert` MUST NOT touch the same
 * field paths — Mongo rejects the entire operation with
 * "Updating the path 'X' would create a conflict at 'X'" otherwise.
 *
 * Exported so the test suite can statically assert this invariant
 * without a live Mongo instance; if someone re-introduces conflicting
 * fields we'll catch it before the next live smoke test.
 */
export function buildArtifactUpsert(
  patch: ArtifactPatch,
  occurredAt: Date,
  now: Date,
): { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> } {
  return {
    $set: {
      ...patch,
      last_event_at: occurredAt,
      updated_at: now,
    },
    $setOnInsert: {
      created_at: now,
    },
  };
}

function projectDeploymentStatus(
  ev: AgenticSdlcEvent,
  repo: OnboardedRepo,
): ArtifactPatch | null {
  const ds = (ev.payload as { deployment_status?: Record<string, unknown> }).deployment_status;
  const dep = (ev.payload as { deployment?: Record<string, unknown> }).deployment;
  if (!ds || !dep) return null;

  const env = (dep.environment as string | undefined) ?? "";
  if (env !== repo.sandbox_environment) return null;

  const dsState = (ds.state as
    | "success"
    | "failure"
    | "error"
    | "in_progress"
    | "queued"
    | "pending"
    | "inactive"
    | undefined) ?? "pending";
  const githubState: ArtifactNativeState =
    dsState === "success"
      ? "success"
      : dsState === "failure" || dsState === "error"
        ? "failure"
        : "in_progress";

  const stage: AgenticSdlcStage =
    dsState === "success"
      ? "deploy"
      : dsState === "failure" || dsState === "error"
        ? "blocked"
        : "deploy";

  return {
    repo_id: ev.repo_id,
    kind: "deploy",
    artifact_id: ev.artifact_id,
    epic_id: ev.epic_id,
    parent_subtask_id: null,
    title: `Deploy → ${env}`,
    body_excerpt: typeof ds.description === "string" ? ds.description.slice(0, 500) : "",
    state: githubState,
    current_stage: stage,
    assignees: [],
    requested_reviewers: [],
    labels: [],
    agent_labels: [],
    needs_human: stage === "blocked",
    stalled_since: null,
    github_url: (ds.target_url as string | undefined) ?? "",
    last_event_at: ev.occurred_at,
  };
}

function readSubIssuePayload(payload: Record<string, unknown>): {
  parentIssue?: Record<string, unknown>;
  subIssue?: Record<string, unknown>;
} {
  const action = typeof payload.action === "string" ? payload.action : "";
  if (action === "parent_issue_added") {
    return {
      parentIssue: payload.parent_issue as Record<string, unknown> | undefined,
      subIssue: payload.sub_issue as Record<string, unknown> | undefined,
    };
  }

  return {
    parentIssue:
      (payload.parent_issue as Record<string, unknown> | undefined) ??
      (payload.issue as Record<string, unknown> | undefined),
    subIssue: payload.sub_issue as Record<string, unknown> | undefined,
  };
}
