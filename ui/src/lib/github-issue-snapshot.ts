/** Pure GitHub issue normalization shared by REST reads and webhook ingress. */

import { githubFullName } from "@/lib/projects/github-repository";

export type LinkedIssuePriority = "critical" | "high" | "medium" | "low";
export type LinkedIssueDisplayStatus = "open" | "in_progress" | "resolved";

export interface LinkedIssueStatus {
  /** Defaults to issue for cache rows created before discussion support. */
  contentType?: "issue" | "discussion";
  repo: string;
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: "open" | "closed";
  stateReason: string | null;
  displayStatus: LinkedIssueDisplayStatus;
  priority: LinkedIssuePriority | null;
  labels: string[];
  assignees: string[];
  author: string | null;
  milestone: string | null;
  category?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
}

export interface GitHubIssueShape {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state?: string;
  state_reason?: string | null;
  labels?: (string | { name?: string | null })[];
  assignees?: ({ login?: string | null } | null)[] | null;
  user?: { login?: string | null } | null;
  milestone?: { title?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
}

export const IN_PROGRESS_LABEL_ALIASES = [
  "status:in-progress",
  "in-progress",
  "in progress",
  "status/in-progress",
] as const;

export function normalizeGitHubRepo(value: string): string {
  const repo = githubFullName(value);
  const parts = repo.split("/").filter(Boolean);
  if (
    parts.length !== 2 ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid GitHub repository reference: ${value}`);
  }
  return `${parts[0]}/${parts[1]}`;
}

export function labelsFrom(issue: GitHubIssueShape): string[] {
  return (issue.labels ?? [])
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .filter(Boolean);
}

export function priorityFromLabels(
  labels: string[],
): LinkedIssuePriority | null {
  const normalized = new Set(labels.map((label) => label.trim().toLowerCase()));
  const matches = (values: string[]) =>
    values.some((value) => normalized.has(value));
  if (
    matches([
      "priority:critical",
      "priority/critical",
      "critical",
      "p0",
      "sev0",
    ])
  ) {
    return "critical";
  }
  if (matches(["priority:high", "priority/high", "high", "p1", "sev1"])) {
    return "high";
  }
  if (matches(["priority:medium", "priority/medium", "medium", "p2", "sev2"])) {
    return "medium";
  }
  if (matches(["priority:low", "priority/low", "low", "p3", "sev3"])) {
    return "low";
  }
  return null;
}

export function displayStatusFromIssue(
  state: "open" | "closed",
  labels: string[],
): LinkedIssueDisplayStatus {
  if (state === "closed") return "resolved";
  const normalized = new Set(labels.map((label) => label.trim().toLowerCase()));
  return IN_PROGRESS_LABEL_ALIASES.some((label) => normalized.has(label))
    ? "in_progress"
    : "open";
}

export function linkedIssueFromGitHub(
  repo: string,
  issue: GitHubIssueShape,
): LinkedIssueStatus {
  const labels = labelsFrom(issue);
  const state = issue.state === "closed" ? "closed" : "open";
  return {
    contentType: "issue",
    repo: normalizeGitHubRepo(repo),
    number: issue.number,
    title: issue.title,
    body: issue.body ?? null,
    url: issue.html_url,
    state,
    stateReason: issue.state_reason ?? null,
    displayStatus: displayStatusFromIssue(state, labels),
    priority: priorityFromLabels(labels),
    labels,
    assignees: (issue.assignees ?? [])
      .map((assignee) => assignee?.login ?? "")
      .filter(Boolean),
    author: issue.user?.login ?? null,
    milestone: issue.milestone?.title ?? null,
    createdAt: issue.created_at ?? null,
    updatedAt: issue.updated_at ?? null,
    closedAt: issue.closed_at ?? null,
  };
}
