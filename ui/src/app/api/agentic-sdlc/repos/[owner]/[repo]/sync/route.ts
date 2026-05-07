/**
 * POST /api/agentic-sdlc/repos/{owner}/{repo}/sync
 *
 * Reconciles current GitHub issue/PR state into the Agentic SDLC derived
 * artifact store. This closes webhook gaps: if local forwarding was down,
 * a reload or manual refresh can pull the latest repo state from GitHub.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  getAgenticSdlcArtifactsCollection,
  getAgenticSdlcEventsCollection,
  getAgenticSdlcReposCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { createGitHubClient, GitHubClientError } from "@/lib/agentic-sdlc/github-client";
import type { RepoIssue } from "@/lib/agentic-sdlc/github-client";
import { buildArtifactUpsert, projectEvent } from "@/lib/agentic-sdlc/projector";
import type {
  AgenticSdlcEvent,
  ArtifactKind,
  OnboardedRepo,
} from "@/types/agentic-sdlc";

const GITHUB_PAGE_SIZE = 100;

async function handle(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string }> },
): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  const authToken = process.env.GITHUB_TOKEN;
  if (!authToken) {
    return Response.json(
      {
        error: "missing_github_token",
        message: "Set GITHUB_TOKEN on the UI server to sync GitHub repo state.",
      },
      { status: 503 },
    );
  }

  const { owner, repo } = await ctx.params;
  const repos = await getAgenticSdlcReposCollection();
  const repoDoc = (await repos.findOne({
    owner,
    name: repo,
    offboarded_at: null,
  })) as OnboardedRepo | null;

  if (!repoDoc) {
    return Response.json(
      { error: "not_found", message: "Repo not onboarded." },
      { status: 404 },
    );
  }

  try {
    const client = createGitHubClient({ authToken });
    const [issues, pullRequests] = await Promise.all([
      client.listRepoIssues(owner, repo, { state: "all", perPage: GITHUB_PAGE_SIZE }),
      client.listRepoPullRequests(owner, repo, {
        state: "all",
        perPage: GITHUB_PAGE_SIZE,
      }),
    ]);

    const nonPullIssues = issues.filter((issue) => !issue.pull_request);
    const subIssueLookups = await Promise.all(
      nonPullIssues
        .filter((issue) => shouldFetchSubIssues(issue))
        .map(async (issue) => ({
          parentIssue: issue,
          subIssues: await client.listIssueSubIssues(owner, repo, issue.number, {
            perPage: GITHUB_PAGE_SIZE,
          }),
        })),
    );
    const linkedSubIssueIds = new Set(
      subIssueLookups.flatMap(({ subIssues }) => subIssues.map((issue) => issue.node_id)),
    );

    const now = new Date();
    const issueEvents = nonPullIssues
      .filter((issue) => !linkedSubIssueIds.has(issue.node_id))
      .map((issue) =>
        makeSyncEvent({
          repo: repoDoc,
          type: "issues",
          action: "synchronize",
          artifactKind: isEpicIssue(issue)
            ? "epic"
            : "subtask",
          artifactId: issue.node_id,
          occurredAt: parseGitHubDate(issue.updated_at, now),
          actorLogin: null,
          payload: { issue },
        }),
      );
    const subIssueEvents = subIssueLookups.flatMap(({ parentIssue, subIssues }) =>
      subIssues.map((subIssue) =>
        makeSyncEvent({
          repo: repoDoc,
          type: "sub_issues",
          action: "synchronize",
          artifactKind: "subtask",
          artifactId: subIssue.node_id,
          occurredAt: parseGitHubDate(subIssue.updated_at, now),
          actorLogin: null,
          payload: { parent_issue: parentIssue, sub_issue: subIssue },
          epicId: parentIssue.node_id,
        }),
      ),
    );
    const prEvents = pullRequests.map((pullRequest) =>
      makeSyncEvent({
        repo: repoDoc,
        type: "pull_request",
        action: "synchronize",
        artifactKind: "pull_request",
        artifactId: pullRequest.node_id,
        occurredAt: parseGitHubDate(pullRequest.updated_at, now),
        actorLogin: null,
        payload: { pull_request: pullRequest },
      }),
    );
    const events = [...issueEvents, ...subIssueEvents, ...prEvents];
    const patches = events
      .map((event) => ({
        event,
        patch: projectEvent(event, repoDoc),
      }))
      .filter((entry): entry is { event: AgenticSdlcEvent; patch: NonNullable<ReturnType<typeof projectEvent>> } =>
        entry.patch !== null,
      );

    const artifacts = await getAgenticSdlcArtifactsCollection();
    if (patches.length > 0) {
      await artifacts.bulkWrite(
        [
          ...patches.map(({ event, patch }) => ({
            updateOne: {
              filter: {
                repo_id: patch.repo_id,
                kind: patch.kind,
                artifact_id: patch.artifact_id,
              },
              update: buildArtifactUpsert(patch, event.occurred_at, now),
              upsert: true,
            },
          })),
          ...subIssueEvents.map((event) => ({
            deleteOne: {
              filter: {
                repo_id: event.repo_id,
                kind: "epic" as const,
                artifact_id: event.artifact_id,
              },
            },
          })),
        ],
        { ordered: false },
      );
    }

    const eventCollection = await getAgenticSdlcEventsCollection();
    if (events.length > 0) {
      await eventCollection.insertMany(events, { ordered: false });
    }

    await repos.updateOne(
      { repo_id: repoDoc.repo_id },
      {
        $set: {
          last_reconciled_at: now,
          webhook_last_event_at: now,
          updated_at: now,
        },
      },
    );

    return Response.json({
      synced: true,
      repo: repoDoc.full_name,
      issues_seen: issues.length,
      pull_requests_seen: pullRequests.length,
      artifacts_upserted: patches.length,
      events_recorded: events.length,
      last_reconciled_at: now.toISOString(),
    });
  } catch (err) {
    if (err instanceof GitHubClientError) {
      return Response.json(
        {
          error: err.code,
          message: err.message,
          documentation_url: err.documentationUrl,
        },
        { status: err.status ?? 502 },
      );
    }
    throw err;
  }
}

function makeSyncEvent(args: {
  repo: OnboardedRepo;
  type: "issues" | "pull_request" | "sub_issues";
  action: "synchronize";
  artifactKind: ArtifactKind;
  artifactId: string;
  occurredAt: Date;
  actorLogin: string | null;
  payload: Record<string, unknown>;
  epicId?: string | null;
}): AgenticSdlcEvent {
  return {
    repo_id: args.repo.repo_id,
    source: "ui",
    github_delivery_id: null,
    github_event_type: args.type,
    github_action: args.action,
    artifact_kind: args.artifactKind,
    artifact_id: args.artifactId,
    epic_id: args.epicId ?? null,
    actor_kind: args.actorLogin ? "human" : "system",
    actor_login: args.actorLogin,
    payload: args.payload,
    delivered_at: new Date(),
    occurred_at: args.occurredAt,
    projection_status: "projected",
    projection_attempts: 1,
  };
}

function labelNames(issue: RepoIssue): string[] {
  return issue.labels.map((label) => label.name).filter((name): name is string => Boolean(name));
}

function isEpicIssue(issue: RepoIssue): boolean {
  const labels = labelNames(issue);
  return (
    labels.includes("epic") ||
    labels.includes("Epic") ||
    Boolean(issue.sub_issues_summary?.total && issue.sub_issues_summary.total > 0) ||
    labels.includes("agent:specify")
  );
}

function shouldFetchSubIssues(issue: RepoIssue): boolean {
  const labels = labelNames(issue);
  return (
    labels.includes("epic") ||
    labels.includes("Epic") ||
    labels.some((label) => label.startsWith("agent:")) ||
    Boolean(issue.sub_issues_summary?.total && issue.sub_issues_summary.total > 0)
  );
}

function parseGitHubDate(value: string | null | undefined, fallback: Date): Date {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isNaN(timestamp) ? fallback : new Date(timestamp);
}

export const POST = withAgenticSdlcGate(handle);
