/**
 * Repository-wide GitHub issues for a TOME project hierarchy.
 * GitHub is authoritative; TOME serves a disposable MongoDB read model.
 */

import { NextRequest } from "next/server";

import {
  ApiError,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  isGitHubAuthError,
  isGitHubNotFoundError,
  normalizeGitHubRepo,
  updateGitHubIssueLabel,
  updateGitHubIssueStatus,
  type LinkedIssueDisplayStatus,
  type LinkedIssueStatus,
} from "@/lib/github-issue-link";
import {
  readableTomeRollupProjects,
  resolveTomeGitHubCredential,
  resolveTomeGitHubWriteCredential,
  rollupGitHubRepos,
} from "@/lib/tome/github-issue-scope";
import {
  loadTomeIssueCache,
  upsertCachedTomeIssue,
} from "@/lib/tome/github-issue-cache";
import type { TomeTrackedIssueLabel } from "@/lib/tome/issue-filter-views";
import { listTomeTrackedIssueLabels } from "@/lib/tome/issue-tracker-store";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function filteredIssues(
  issues: LinkedIssueStatus[],
  searchParams: URLSearchParams,
  trackedLabels: readonly TomeTrackedIssueLabel[],
): LinkedIssueStatus[] {
  const labels = searchParams
    .getAll("label")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const labelsAny = searchParams
    .getAll("label_any")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const state = searchParams.get("state");
  const contentType = searchParams.get("content_type");
  const repo = searchParams.get("repo")?.trim().toLowerCase();
  const query = searchParams.get("q")?.trim().toLowerCase();
  const number = Number(searchParams.get("number"));
  const requestedLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 1000)
    : null;
  const filtered = issues.filter((issue) => {
    const normalized = new Set(
      issue.labels.map((label) => label.trim().toLowerCase()),
    );
    const searchableText = [
      issue.repo,
      issue.number,
      `#${issue.number}`,
      issue.title,
      issue.body,
      ...issue.labels,
      ...issue.assignees,
      issue.author,
      issue.milestone,
      issue.category,
    ]
      .filter((value): value is string | number => value != null)
      .join(" ")
      .toLowerCase();
    return (
      trackedLabels.some(({ label }) => normalized.has(label)) &&
      (!labels.length || labels.every((label) => normalized.has(label))) &&
      (!labelsAny.length || labelsAny.some((label) => normalized.has(label))) &&
      (!contentType ||
        contentType === "all" ||
        (issue.contentType ?? "issue") === contentType) &&
      (!state || state === "all" || issue.state === state) &&
      (!repo || issue.repo.toLowerCase() === repo) &&
      (!query || searchableText.includes(query)) &&
      (!Number.isInteger(number) || number <= 0 || issue.number === number)
    );
  });
  return limit == null ? filtered : filtered.slice(0, limit);
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const rollup = await readableTomeRollupProjects(tctx);
  const repos = rollupGitHubRepos(rollup);
  const trackedLabels = await listTomeTrackedIssueLabels(
    rollup.map((project) => String(project._id)),
  );
  const writeCredential = await resolveTomeGitHubWriteCredential(tctx);

  const credential = await resolveTomeGitHubCredential(tctx);
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  try {
    const cached = await loadTomeIssueCache({
      repos,
      token: credential.token,
      refresh,
    });
    const issues = filteredIssues(cached.issues, request.nextUrl.searchParams, trackedLabels);
    const lastSynchronizedAt = cached.sync
      .map((state) => state.last_full_sync_at)
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    return successResponse({
      issues,
      credentialConfigured: Boolean(credential.token),
      credentialSource: credential.source,
      writeCredentialConfigured: Boolean(writeCredential.token),
      writeCredentialOwner: writeCredential.ownerEmail ?? null,
      repos,
      trackedLabels,
      rollupProjectSlugs: rollup.map((project) => project.slug),
      cache: {
        source: "mongodb",
        stale: cached.sync.some((state) => state.needs_reconciliation),
        lastSynchronizedAt: lastSynchronizedAt?.toISOString() ?? null,
        errors: cached.syncErrors,
      },
    });
  } catch (err) {
    if (isGitHubAuthError(err)) {
      throw new ApiError(
        "GitHub authorization has expired",
        503,
        "GITHUB_CREDENTIAL_INVALID",
      );
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      err.status === 403
    ) {
      throw new ApiError(
        "GitHub denied access or the API rate limit was reached",
        503,
        "GITHUB_ACCESS_DENIED",
      );
    }
    throw err;
  }
});

const ISSUE_STATUSES = new Set<LinkedIssueDisplayStatus>([
  "open",
  "in_progress",
  "resolved",
]);

export const PATCH = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const body = (await request.json().catch(() => null)) as {
    repo?: unknown;
    number?: unknown;
    status?: unknown;
    label?: unknown;
    operation?: unknown;
  } | null;
  const statusUpdate = Boolean(
    body &&
    typeof body.status === "string" &&
    ISSUE_STATUSES.has(body.status as LinkedIssueDisplayStatus),
  );
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const labelUpdate = Boolean(
    label &&
    label.length <= 50 &&
    (body?.operation === "add" || body?.operation === "remove"),
  );
  if (!body ||
    typeof body.repo !== "string" ||
    !Number.isInteger(body.number) ||
    Number(statusUpdate) + Number(labelUpdate) !== 1
  ) {
    throw new ApiError(
      "Repository, positive issue number, and exactly one valid status or label update are required",
      400,
      "INVALID_ISSUE_UPDATE",
    );
  }
  const issueNumber = body.number as number;
  if (issueNumber <= 0) {
    throw new ApiError(
      "Repository, positive issue number, and exactly one valid status or label update are required",
      400,
      "INVALID_ISSUE_UPDATE",
    );
  }

  let repo: string;
  try {
    repo = normalizeGitHubRepo(body.repo);
  } catch {
    throw new ApiError(
      "Invalid GitHub repository",
      400,
      "INVALID_GITHUB_REPOSITORY",
    );
  }
  const rollup = await readableTomeRollupProjects(tctx);
  const repos = rollupGitHubRepos(rollup);
  const trackedLabels = await listTomeTrackedIssueLabels(
    rollup.map((project) => String(project._id)),
  );
  if (labelUpdate && !trackedLabels.some((tracked) => tracked.label === label.toLowerCase())) {
    throw new ApiError(
      "This label is not configured as a TOME issue tracker",
      400,
      "UNTRACKED_TOME_ISSUE_LABEL",
    );
  }
  const scopedRepo = repos.find(
    (candidate) => candidate.toLowerCase() === repo.toLowerCase(),
  );
  if (!scopedRepo) {
    throw new ApiError(
      "GitHub repository is not attached to this TOME project",
      403,
      "GITHUB_REPOSITORY_OUT_OF_SCOPE",
    );
  }

  const credential = await resolveTomeGitHubWriteCredential(tctx);
  if (!credential.token) {
    const owner = credential.ownerEmail
      ? `The data steward ${credential.ownerEmail}`
      : "A user data steward";
    throw new ApiError(
      `${owner} must authorize GitHub in Connected Credentials before issues can be updated`,
      503,
      "TOME_STEWARD_GITHUB_CREDENTIAL_REQUIRED",
    );
  }

  try {
    if (labelUpdate) {
      const issue = await updateGitHubIssueLabel(
        credential.token,
        scopedRepo,
        issueNumber,
        label,
        body.operation as "add" | "remove",
      );
      await upsertCachedTomeIssue(issue, {
        eventType: "tome.issue-label",
        deliveryId: null,
      });
      return successResponse({ issue });
    }

    const result = await updateGitHubIssueStatus(
      credential.token,
      scopedRepo,
      issueNumber,
      body.status as LinkedIssueDisplayStatus,
    );
    await upsertCachedTomeIssue(result.issue, {
      eventType: "tome.issue-status",
      deliveryId: null,
    });
    const projectStatusIncomplete =
      result.projectStatus.queryFailed || result.projectStatus.failed.length > 0;
    const projectStatusUnmapped = result.projectStatus.skipped.length > 0;
    return successResponse({
      issue: result.issue,
      projectStatus: result.projectStatus,
      ...(projectStatusIncomplete
        ? {
            warning:
              "The issue moved, but its GitHub Project status could not be updated. The data steward must reauthorize GitHub in Connected Credentials with Projects write access",
            warningCode: "TOME_STEWARD_GITHUB_PROJECT_WRITE_DENIED",
          }
        : projectStatusUnmapped
          ? {
              warning:
                "The issue moved, but at least one linked GitHub Project has no compatible Status option for this TOME column",
              warningCode: "GITHUB_PROJECT_STATUS_UNMAPPED",
            }
        : {}),
    });
  } catch (err) {
    if (isGitHubAuthError(err)) {
      throw new ApiError(
        "The data steward's GitHub authorization has expired. Reauthorize GitHub in Connected Credentials",
        503,
        "TOME_STEWARD_GITHUB_CREDENTIAL_INVALID",
      );
    }
    if (isGitHubNotFoundError(err)) {
      throw new ApiError(
        "GitHub issue was not found",
        404,
        "GITHUB_ISSUE_NOT_FOUND",
      );
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      (err.status === 403 || err.status === 422)
    ) {
      throw new ApiError(
        "The data steward's GitHub connection cannot update this repository. Reauthorize GitHub in Connected Credentials with issue write access",
        403,
        "TOME_STEWARD_GITHUB_WRITE_DENIED",
      );
    }
    throw err;
  }
});
