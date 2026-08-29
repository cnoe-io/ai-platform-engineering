/** Shared GitHub webhook consumer for TOME's MongoDB issue read model. */

import type { LinkedIssueStatus } from "@/lib/github-issue-link";
import { getCollection } from "@/lib/mongodb";
import { githubFullName } from "@/lib/projects/github-repository";
import {
  markTomeIssueRepoStale,
  upsertCachedTomeIssue,
} from "@/lib/tome/github-issue-cache";
import type { ProjectDocument } from "@/types/projects";

const ISSUE_CACHE_EVENTS = new Set([
  "issues",
  "issue_comment",
  "discussion",
  "discussion_comment",
  "label",
  "milestone",
]);

function normalizeRepo(value: string): string {
  const repo = githubFullName(value);
  if (repo.split("/").filter(Boolean).length !== 2) {
    throw new Error(`Invalid GitHub repository reference: ${value}`);
  }
  return repo;
}

export function isTomeIssueCacheEvent(eventType: string): boolean {
  return ISSUE_CACHE_EVENTS.has(eventType);
}

function attachedRepoCandidates(fullName: string): string[] {
  return [
    fullName,
    `https://github.com/${fullName}`,
    `https://github.com/${fullName}.git`,
  ];
}

export async function isRepositoryAttachedToTome(
  repoId: number,
  fullName: string,
): Promise<boolean> {
  const projects = await getCollection<ProjectDocument>("projects");
  const candidates = attachedRepoCandidates(normalizeRepo(fullName));
  return Boolean(
    await projects.findOne(
      {
        $or: [
          { "sources.github_repos.id": repoId },
          { "sources.github_repos.full_name": candidates[0] },
          { "sources.repos": { $in: candidates } },
        ],
      },
      { projection: { _id: 1 } },
    ),
  );
}

function isLinkedIssue(value: unknown): value is LinkedIssueStatus {
  if (typeof value !== "object" || value === null) return false;
  const issue = value as Partial<LinkedIssueStatus>;
  return (
    typeof issue.repo === "string" &&
    typeof issue.number === "number" &&
    typeof issue.title === "string" &&
    typeof issue.url === "string" &&
    (issue.state === "open" || issue.state === "closed") &&
    Array.isArray(issue.labels)
  );
}

export async function recordTomeIssueCacheEvent(input: {
  repoId: number;
  fullName: string;
  eventType: string;
  deliveryId: string | null;
  issue?: unknown;
  discussion?: unknown;
}): Promise<void> {
  if (!isTomeIssueCacheEvent(input.eventType)) return;
  if (
    (input.eventType === "issues" || input.eventType === "issue_comment") &&
    isLinkedIssue(input.issue)
  ) {
    await upsertCachedTomeIssue(input.issue, {
      repoId: input.repoId,
      eventType: input.eventType,
      deliveryId: input.deliveryId,
      webhook: true,
    });
    return;
  }
  if (
    (input.eventType === "discussion" ||
      input.eventType === "discussion_comment") &&
    isLinkedIssue(input.discussion)
  ) {
    await upsertCachedTomeIssue(input.discussion, {
      repoId: input.repoId,
      eventType: input.eventType,
      deliveryId: input.deliveryId,
      webhook: true,
    });
    return;
  }
  if (
    input.eventType === "issues" ||
    input.eventType === "issue_comment" ||
    input.eventType === "discussion" ||
    input.eventType === "discussion_comment"
  ) {
    // `issue_comment` also fires for pull requests. Those are intentionally
    // excluded from TOME's issue board and must not force a full reconciliation.
    return;
  }

  // Repository-wide label/milestone changes can affect many cached rows and
  // do not identify all impacted issues. Reconcile on the next authorized load.
  await markTomeIssueRepoStale({
    repoId: input.repoId,
    fullName: input.fullName,
    eventType: input.eventType,
    deliveryId: input.deliveryId,
    webhook: true,
  });
}
