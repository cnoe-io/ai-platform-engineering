/**
 * MongoDB-backed materialized view of GitHub issues used by TOME.
 *
 * GitHub remains authoritative. These rows are disposable and are rebuilt on
 * first load, explicit refresh, or when a repository-wide webhook marks the
 * snapshot stale. Issue webhooks update individual rows directly.
 */

import { randomUUID } from "crypto";

import type { AnyBulkWriteOperation } from "mongodb";

import { listDiscussionsAcrossRepos } from "@/lib/github-discussion-link";
import {
  listIssuesAcrossRepos,
  normalizeGitHubRepo,
  type LinkedIssueStatus,
} from "@/lib/github-issue-link";
import { getCollection } from "@/lib/mongodb";
import {
  TOME_COLLECTIONS,
  type TomeGitHubIssueCacheRow,
  type TomeGitHubRepoSync,
} from "@/types/tome";

const ISSUE_CONTEXT_LIMIT = 20;
const SYNC_LEASE_MS = 60_000;
const SYNC_WAIT_ATTEMPTS = 40;

export interface AgentIssueContextItem {
  content_type: "issue" | "discussion";
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed";
  display_status: "open" | "in_progress" | "resolved";
  labels: string[];
  assignees: string[];
  updated_at: string | null;
  url: string;
}

export interface AgentIssueContext {
  decisions: AgentIssueContextItem[];
  critical: AgentIssueContextItem[];
  decision_count: number;
  critical_count: number;
  decision_truncated: boolean;
  critical_truncated: boolean;
}

export interface TomeIssueCacheResult {
  issues: LinkedIssueStatus[];
  sync: TomeGitHubRepoSync[];
  syncErrors: string[];
}

function repoKey(repo: string): string {
  return normalizeGitHubRepo(repo).toLowerCase();
}

function issueKey(repo: string, number: number): string {
  return `${repoKey(repo)}#${number}`;
}

function cacheKey(issue: LinkedIssueStatus): string {
  const repo = repoKey(issue.repo);
  return issue.contentType === "discussion"
    ? `${repo}:discussion#${issue.number}`
    : issueKey(repo, issue.number);
}

function normalizedLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => label.trim().toLowerCase()).filter(Boolean))];
}

function toRow(
  issue: LinkedIssueStatus,
  options: { cachedAt?: Date; fullSyncId?: string } = {},
): TomeGitHubIssueCacheRow {
  const repo = repoKey(issue.repo);
  return {
    _id: cacheKey(issue),
    content_type: issue.contentType ?? "issue",
    repo,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    url: issue.url,
    state: issue.state,
    state_reason: issue.stateReason,
    display_status: issue.displayStatus,
    priority: issue.priority,
    labels: issue.labels,
    labels_normalized: normalizedLabels(issue.labels),
    assignees: issue.assignees,
    author: issue.author,
    milestone: issue.milestone,
    category: issue.category ?? null,
    github_created_at: issue.createdAt,
    github_updated_at: issue.updatedAt,
    github_closed_at: issue.closedAt,
    cached_at: options.cachedAt ?? new Date(),
    ...(options.fullSyncId ? { full_sync_id: options.fullSyncId } : {}),
  };
}

function fromRow(row: TomeGitHubIssueCacheRow): LinkedIssueStatus {
  return {
    contentType: row.content_type ?? "issue",
    repo: row.repo,
    number: row.number,
    title: row.title,
    body: row.body,
    url: row.url,
    state: row.state,
    stateReason: row.state_reason,
    displayStatus: row.display_status,
    priority: row.priority,
    labels: row.labels,
    assignees: row.assignees,
    author: row.author,
    milestone: row.milestone,
    category: row.category ?? null,
    createdAt: row.github_created_at,
    updatedAt: row.github_updated_at,
    closedAt: row.github_closed_at,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "Unknown GitHub sync error";
}

async function cachedRows(repos: string[]): Promise<TomeGitHubIssueCacheRow[]> {
  const normalized = [...new Set(repos.map(repoKey))];
  if (!normalized.length) return [];
  const issues = await getCollection<TomeGitHubIssueCacheRow>(TOME_COLLECTIONS.GITHUB_ISSUES);
  return issues
    .find({ repo: { $in: normalized } })
    .sort({ github_updated_at: -1, _id: 1 })
    .toArray();
}

export async function listCachedTomeIssues(repos: string[]): Promise<LinkedIssueStatus[]> {
  return (await cachedRows(repos)).map(fromRow);
}

export async function getTomeRepoSyncs(repos: string[]): Promise<TomeGitHubRepoSync[]> {
  const normalized = [...new Set(repos.map(repoKey))];
  if (!normalized.length) return [];
  const syncs = await getCollection<TomeGitHubRepoSync>(TOME_COLLECTIONS.GITHUB_REPO_SYNCS);
  return syncs.find({ _id: { $in: normalized } }).sort({ _id: 1 }).toArray();
}

async function syncRepository(token: string, repo: string): Promise<void> {
  const normalizedRepo = repoKey(repo);
  const syncId = randomUUID();
  const startedAt = new Date();
  const syncs = await getCollection<TomeGitHubRepoSync>(TOME_COLLECTIONS.GITHUB_REPO_SYNCS);
  const issues = await getCollection<TomeGitHubIssueCacheRow>(TOME_COLLECTIONS.GITHUB_ISSUES);
  let claimed = false;
  try {
    const claim = await syncs.findOneAndUpdate(
      {
        _id: normalizedRepo,
        $or: [
          { status: { $ne: "syncing" } },
          { lease_until: { $lte: startedAt } },
          { lease_until: { $exists: false } },
        ],
      },
      {
        $set: {
          status: "syncing",
          sync_owner: syncId,
          lease_until: new Date(startedAt.getTime() + SYNC_LEASE_MS),
          updated_at: startedAt,
          last_error: null,
        },
        $setOnInsert: {
          repo_id: null,
          cache_generation: 0,
          needs_reconciliation: true,
          issue_count: 0,
          last_event_type: null,
          last_delivery_id: null,
          last_webhook_at: null,
          last_full_sync_at: null,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    claimed = claim?.sync_owner === syncId;
  } catch (error) {
    // A concurrent cold-load may win the unique `_id` upsert race.
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  if (!claimed) {
    for (let attempt = 0; attempt < SYNC_WAIT_ATTEMPTS; attempt += 1) {
      const state = await syncs.findOne({ _id: normalizedRepo });
      if (state?.status !== "syncing") return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return;
  }

  try {
    const [upstreamIssues, upstreamDiscussions] = await Promise.all([
      listIssuesAcrossRepos(token, [normalizedRepo], { refresh: true }),
      listDiscussionsAcrossRepos(token, [normalizedRepo]),
    ]);
    const upstream = [...upstreamIssues, ...upstreamDiscussions].sort(
      (left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    );
    const cachedAt = new Date();
    const writes: AnyBulkWriteOperation<TomeGitHubIssueCacheRow>[] = upstream.map((issue) => {
      const row = toRow(issue, { cachedAt, fullSyncId: syncId });
      return {
        replaceOne: {
          filter: { _id: row._id },
          replacement: row,
          upsert: true,
        },
      };
    });
    if (writes.length) await issues.bulkWrite(writes, { ordered: false });

    // Preserve a row written by a webhook while this full sync was running.
    await issues.deleteMany({
      repo: normalizedRepo,
      full_sync_id: { $ne: syncId },
      $or: [
        { cached_at: { $lte: startedAt } },
        { cached_at: { $exists: false } },
      ],
    });
    const latestSync = await syncs.findOne({ _id: normalizedRepo });
    const repoWideWebhookDuringSync = Boolean(
      latestSync?.last_webhook_at &&
      latestSync.last_webhook_at > startedAt &&
      (latestSync.last_event_type === "label" || latestSync.last_event_type === "milestone"),
    );
    await syncs.updateOne(
      { _id: normalizedRepo, sync_owner: syncId },
      {
        $set: {
          status: repoWideWebhookDuringSync ? "stale" : "ready",
          needs_reconciliation: repoWideWebhookDuringSync,
          issue_count: upstreamIssues.length,
          discussion_count: upstreamDiscussions.length,
          last_full_sync_at: cachedAt,
          last_error: null,
          updated_at: cachedAt,
        },
        $inc: { cache_generation: 1 },
        $unset: { sync_owner: "", lease_until: "" },
      },
    );
  } catch (error) {
    const failedAt = new Date();
    await syncs.updateOne(
      { _id: normalizedRepo, sync_owner: syncId },
      {
        $set: {
          status: "error",
          needs_reconciliation: true,
          last_error: errorMessage(error),
          updated_at: failedAt,
        },
        $unset: { sync_owner: "", lease_until: "" },
      },
    );
    throw error;
  }
}

export async function loadTomeIssueCache(input: {
  repos: string[];
  token?: string;
  refresh?: boolean;
}): Promise<TomeIssueCacheResult> {
  const repos = [...new Set(input.repos.map(repoKey))];
  if (!repos.length) return { issues: [], sync: [], syncErrors: [] };

  const before = await getTomeRepoSyncs(repos);
  const byRepo = new Map(before.map((row) => [row._id, row]));
  const needsSync = repos.filter((repo) => {
    const state = byRepo.get(repo);
    // Normal reads hit GitHub only for a cold cache or a webhook-staled repo.
    // A failed sync stays stale until another webhook or explicit refresh,
    // avoiding a GitHub retry storm on ordinary page/agent loads.
    return Boolean(input.refresh || !state || state.status === "stale");
  });
  const errors: unknown[] = [];
  if (input.token && needsSync.length) {
    for (let index = 0; index < needsSync.length; index += 3) {
      const batch = needsSync.slice(index, index + 3);
      const results = await Promise.allSettled(
        batch.map((repo) => syncRepository(input.token as string, repo)),
      );
      for (const result of results) {
        if (result.status === "rejected") errors.push(result.reason);
      }
    }
  }

  const [rows, sync] = await Promise.all([cachedRows(repos), getTomeRepoSyncs(repos)]);
  if (!rows.length && errors.length) throw errors[0];
  return {
    issues: rows.map(fromRow),
    sync,
    syncErrors: errors.map(errorMessage),
  };
}

export async function upsertCachedTomeIssue(
  issue: LinkedIssueStatus,
  metadata: {
    repoId?: number | null;
    eventType: string;
    deliveryId?: string | null;
    webhook?: boolean;
  },
): Promise<void> {
  const row = toRow(issue);
  const issues = await getCollection<TomeGitHubIssueCacheRow>(TOME_COLLECTIONS.GITHUB_ISSUES);
  const existing = await issues.findOne({ _id: row._id });
  let cacheChanged = false;
  if (!existing || (existing.github_updated_at ?? "") <= (row.github_updated_at ?? "")) {
    await issues.replaceOne({ _id: row._id }, row, { upsert: true });
    cacheChanged = true;
  }

  const now = new Date();
  const syncs = await getCollection<TomeGitHubRepoSync>(TOME_COLLECTIONS.GITHUB_REPO_SYNCS);
  const previousSync = await syncs.findOne({ _id: row.repo });
  const needsReconciliation = previousSync?.needs_reconciliation ?? true;
  await syncs.updateOne(
    { _id: row.repo },
    {
      $set: {
        status: previousSync?.status === "syncing"
          ? "syncing"
          : needsReconciliation
            ? "stale"
            : "ready",
        needs_reconciliation: needsReconciliation,
        repo_id: metadata.repoId == null ? null : String(metadata.repoId),
        last_event_type: metadata.eventType,
        last_delivery_id: metadata.deliveryId ?? null,
        ...(metadata.webhook ? { last_webhook_at: now } : {}),
        updated_at: now,
        last_error: null,
      },
      $setOnInsert: {
        issue_count: 0,
        last_full_sync_at: null,
      },
      ...(cacheChanged ? { $inc: { cache_generation: 1 } } : {}),
    },
    { upsert: true },
  );
}

export async function markTomeIssueRepoStale(input: {
  repoId?: number | null;
  fullName: string;
  eventType: string;
  deliveryId?: string | null;
  webhook?: boolean;
}): Promise<void> {
  const repo = repoKey(input.fullName);
  const now = new Date();
  const syncs = await getCollection<TomeGitHubRepoSync>(TOME_COLLECTIONS.GITHUB_REPO_SYNCS);
  const previousSync = await syncs.findOne({ _id: repo });
  await syncs.updateOne(
    { _id: repo },
    {
      $set: {
        status: previousSync?.status === "syncing" ? "syncing" : "stale",
        needs_reconciliation: true,
        repo_id: input.repoId == null ? null : String(input.repoId),
        last_event_type: input.eventType,
        last_delivery_id: input.deliveryId ?? null,
        ...(input.webhook ? { last_webhook_at: now } : {}),
        updated_at: now,
      },
      $setOnInsert: {
        issue_count: 0,
        last_full_sync_at: null,
        last_error: null,
      },
      $inc: { cache_generation: 1 },
    },
    { upsert: true },
  );
}

function toContextItem(issue: LinkedIssueStatus): AgentIssueContextItem {
  return {
    content_type: issue.contentType ?? "issue",
    repo: issue.repo,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    display_status: issue.displayStatus,
    labels: issue.labels,
    assignees: issue.assignees,
    updated_at: issue.updatedAt,
    url: issue.url,
  };
}

export async function buildTomeIssueContext(
  repos: string[],
  limit = ISSUE_CONTEXT_LIMIT,
): Promise<AgentIssueContext> {
  const issues = await listCachedTomeIssues(repos);
  const hasLabel = (issue: LinkedIssueStatus, label: string) =>
    normalizedLabels(issue.labels).includes(label);
  const decisions = issues.filter((issue) => hasLabel(issue, "decision"));
  const critical = issues.filter(
    (issue) => issue.state === "open" && hasLabel(issue, "critical"),
  );
  return {
    decisions: decisions.slice(0, limit).map(toContextItem),
    critical: critical.slice(0, limit).map(toContextItem),
    decision_count: decisions.length,
    critical_count: critical.length,
    decision_truncated: decisions.length > limit,
    critical_truncated: critical.length > limit,
  };
}
