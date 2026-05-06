/**
 * Pure projection: GitHub event payload + repo overrides → artifact patch.
 *
 * Extracted from async-worker.ts so unit tests can exercise it without
 * pulling in the Mongo driver transitive dependency.
 *
 * No I/O, no env, no network.
 */

import { resolveStage, deriveNeedsHuman } from "@/lib/ship-loop/stage-resolver";
import type {
  ArtifactKindStored,
  ArtifactNativeState,
  OnboardedRepo,
  ShipLoopArtifact,
  ShipLoopEvent,
  ShipLoopStage,
} from "@/types/ship-loop";

export type ArtifactPatch = Pick<
  ShipLoopArtifact,
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
  ev: ShipLoopEvent,
  repo: OnboardedRepo,
): ArtifactPatch | null {
  switch (ev.github_event_type) {
    case "pull_request":
      return projectPullRequest(ev, repo);
    case "issues":
      return projectIssue(ev, repo);
    case "deployment_status":
      return projectDeploymentStatus(ev, repo);
    case "pull_request_review":
      return null;
    default:
      return null;
  }
}

function projectPullRequest(
  ev: ShipLoopEvent,
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
  ev: ShipLoopEvent,
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

  const isEpic = labels.some((l) => l === "epic" || l === "Epic");
  const kind: ArtifactKindStored = isEpic ? "epic" : "subtask";

  return {
    repo_id: ev.repo_id,
    kind,
    artifact_id: ev.artifact_id,
    epic_id: ev.epic_id,
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

function projectDeploymentStatus(
  ev: ShipLoopEvent,
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

  const stage: ShipLoopStage =
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
