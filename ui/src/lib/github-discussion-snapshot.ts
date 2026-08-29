/** Pure GitHub Discussion webhook normalization shared by ingress and reads. */

import {
  displayStatusFromIssue,
  normalizeGitHubRepo,
  priorityFromLabels,
  type LinkedIssueStatus,
} from "@/lib/github-issue-snapshot";

export interface GitHubDiscussionWebhookShape {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state?: string;
  state_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  user?: { login?: string | null } | null;
  category?: { name?: string | null } | null;
  labels?: Array<string | { name?: string | null }>;
}

export function linkedDiscussionFromWebhook(
  repo: string,
  discussion: GitHubDiscussionWebhookShape,
): LinkedIssueStatus {
  const labels = (discussion.labels ?? [])
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .filter(Boolean);
  const state =
    discussion.state === "closed" || Boolean(discussion.closed_at)
      ? "closed"
      : "open";
  return {
    contentType: "discussion",
    repo: normalizeGitHubRepo(repo),
    number: discussion.number,
    title: discussion.title,
    body: discussion.body ?? null,
    url: discussion.html_url,
    state,
    stateReason: discussion.state_reason ?? null,
    displayStatus: displayStatusFromIssue(state, labels),
    priority: priorityFromLabels(labels),
    labels,
    assignees: [],
    author: discussion.user?.login ?? null,
    milestone: null,
    category: discussion.category?.name ?? null,
    createdAt: discussion.created_at ?? null,
    updatedAt: discussion.updated_at ?? null,
    closedAt: discussion.closed_at ?? null,
  };
}
