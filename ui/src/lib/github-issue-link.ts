/** Live GitHub issue reads/writes used to synchronize TOME's MongoDB cache. */

import { Octokit } from "@octokit/rest";

import {
  IN_PROGRESS_LABEL_ALIASES,
  labelsFrom,
  linkedIssueFromGitHub,
  normalizeGitHubRepo,
  type LinkedIssueDisplayStatus,
  type LinkedIssueStatus,
} from "@/lib/github-issue-snapshot";

export {
  displayStatusFromIssue,
  linkedIssueFromGitHub,
  normalizeGitHubRepo,
  priorityFromLabels,
  type GitHubIssueShape,
  type LinkedIssueDisplayStatus,
  type LinkedIssuePriority,
  type LinkedIssueStatus,
} from "@/lib/github-issue-snapshot";

const IN_PROGRESS_LABEL_CACHE_TTL_MS = 300_000;
const inProgressLabelCache = new Map<
  string,
  { expiresAt: number; label: string }
>();

const PROJECT_STATUS_ALIASES: Record<LinkedIssueDisplayStatus, string[]> = {
  open: ["todo", "to do", "backlog", "open", "not started", "planned", "new"],
  in_progress: ["in progress", "doing", "active", "started"],
  resolved: ["done", "completed", "complete", "resolved", "closed"],
};

interface ProjectStatusOption {
  id: string;
  name: string;
}

interface LinkedProjectItem {
  id: string;
  project: {
    id: string;
    title: string;
    url: string;
    field: {
      id: string;
      name: string;
      options: ProjectStatusOption[];
    } | null;
  };
}

interface ProjectItemsQuery {
  node: {
    projectItems: {
      nodes: LinkedProjectItem[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

export interface GitHubProjectStatusUpdate {
  projectId: string;
  projectTitle: string;
  projectUrl: string;
  status: string;
}

export interface GitHubProjectStatusSkip {
  projectId: string;
  projectTitle: string;
  projectUrl: string;
  reason: "missing_status_field" | "missing_status_option";
}

export interface GitHubProjectStatusFailure {
  projectId: string;
  projectTitle: string;
  projectUrl: string;
}

export interface GitHubProjectStatusSync {
  linkedProjectCount: number;
  updated: GitHubProjectStatusUpdate[];
  skipped: GitHubProjectStatusSkip[];
  failed: GitHubProjectStatusFailure[];
  queryFailed: boolean;
}

export interface GitHubIssueStatusUpdateResult {
  issue: LinkedIssueStatus;
  projectStatus: GitHubProjectStatusSync;
}

export type GitHubIssueLabelOperation = "add" | "remove";

const EMPTY_PROJECT_STATUS_SYNC: GitHubProjectStatusSync = {
  linkedProjectCount: 0,
  updated: [],
  skipped: [],
  failed: [],
  queryFailed: false,
};

function normalizedProjectStatus(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function projectStatusOptionFor(
  options: ProjectStatusOption[],
  targetStatus: LinkedIssueDisplayStatus,
): ProjectStatusOption | null {
  const optionsByName = new Map(
    options.map((option) => [normalizedProjectStatus(option.name), option]),
  );
  for (const alias of PROJECT_STATUS_ALIASES[targetStatus]) {
    const option = optionsByName.get(alias);
    if (option) return option;
  }
  return null;
}

async function linkedProjectItems(
  octokit: Octokit,
  issueNodeId: string,
): Promise<LinkedProjectItem[]> {
  const items: LinkedProjectItem[] = [];
  let after: string | null = null;
  do {
    const data: ProjectItemsQuery = await octokit.graphql<ProjectItemsQuery>(
      `query TomeLinkedIssueProjects($issueId: ID!, $after: String) {
        node(id: $issueId) {
          ... on Issue {
            projectItems(first: 100, after: $after, includeArchived: false) {
              nodes {
                id
                project {
                  id
                  title
                  url
                  field(name: "Status") {
                    ... on ProjectV2SingleSelectField {
                      id
                      name
                      options { id name }
                    }
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      { issueId: issueNodeId, after },
    );
    if (!data.node) break;
    items.push(...data.node.projectItems.nodes);
    const pageInfo = data.node.projectItems.pageInfo;
    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (after);
  return items;
}

async function updateLinkedProjectStatuses(
  octokit: Octokit,
  issueNodeId: string | undefined,
  targetStatus: LinkedIssueDisplayStatus,
): Promise<GitHubProjectStatusSync> {
  if (!issueNodeId) return { ...EMPTY_PROJECT_STATUS_SYNC };

  let items: LinkedProjectItem[];
  try {
    items = await linkedProjectItems(octokit, issueNodeId);
  } catch {
    return { ...EMPTY_PROJECT_STATUS_SYNC, queryFailed: true };
  }

  const result: GitHubProjectStatusSync = {
    linkedProjectCount: items.length,
    updated: [],
    skipped: [],
    failed: [],
    queryFailed: false,
  };
  for (const item of items) {
    const field = item.project.field;
    if (!field) {
      result.skipped.push({
        projectId: item.project.id,
        projectTitle: item.project.title,
        projectUrl: item.project.url,
        reason: "missing_status_field",
      });
      continue;
    }
    const option = projectStatusOptionFor(field.options, targetStatus);
    if (!option) {
      result.skipped.push({
        projectId: item.project.id,
        projectTitle: item.project.title,
        projectUrl: item.project.url,
        reason: "missing_status_option",
      });
      continue;
    }

    try {
      await octokit.graphql(
        `mutation TomeUpdateProjectStatus(
          $projectId: ID!
          $itemId: ID!
          $fieldId: ID!
          $optionId: String!
        ) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
          }) {
            projectV2Item { id }
          }
        }`,
        {
          projectId: item.project.id,
          itemId: item.id,
          fieldId: field.id,
          optionId: option.id,
        },
      );
      result.updated.push({
        projectId: item.project.id,
        projectTitle: item.project.title,
        projectUrl: item.project.url,
        status: option.name,
      });
    } catch {
      result.failed.push({
        projectId: item.project.id,
        projectTitle: item.project.title,
        projectUrl: item.project.url,
      });
    }
  }
  return result;
}

export function isGitHubAuthError(err: unknown): boolean {
  return Boolean(
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    err.status === 401,
  );
}

export function isGitHubNotFoundError(err: unknown): boolean {
  return Boolean(
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    err.status === 404,
  );
}

function isInProgressLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return IN_PROGRESS_LABEL_ALIASES.some((alias) => alias === normalized);
}

async function repoInProgressLabel(
  octokit: Octokit,
  _token: string,
  repo: string,
): Promise<string> {
  const key = repo.toLowerCase();
  const cached = inProgressLabelCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.label;

  const [owner, name] = repo.split("/");
  const labels = await octokit.paginate(octokit.issues.listLabelsForRepo, {
    owner,
    repo: name,
    per_page: 100,
  });
  const labelsByName = new Map(
    labels
      .map((label) => label.name)
      .filter((label): label is string => Boolean(label))
      .map((label) => [label.trim().toLowerCase(), label]),
  );
  let selected = IN_PROGRESS_LABEL_ALIASES.map((alias) =>
    labelsByName.get(alias),
  ).find((label): label is string => Boolean(label));

  if (!selected) {
    selected = "status:in-progress";
    try {
      await octokit.issues.createLabel({
        owner,
        repo: name,
        name: selected,
        color: "fbca04",
        description: "Issue work is in progress",
      });
    } catch (err) {
      // A concurrent request may have created the canonical label first.
      if (
        typeof err !== "object" ||
        err === null ||
        !("status" in err) ||
        err.status !== 422
      ) {
        throw err;
      }
    }
  }

  inProgressLabelCache.set(key, {
    expiresAt: Date.now() + IN_PROGRESS_LABEL_CACHE_TTL_MS,
    label: selected,
  });
  return selected;
}

/**
 * Move an issue between TOME's board columns by updating GitHub itself.
 * TOME stores no status row: closed issues are resolved, while the two open
 * columns are distinguished by a repository-owned in-progress label.
 */
export async function updateGitHubIssueStatus(
  token: string,
  repo: string,
  issueNumber: number,
  targetStatus: LinkedIssueDisplayStatus,
): Promise<GitHubIssueStatusUpdateResult> {
  const normalizedRepo = normalizeGitHubRepo(repo);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("Invalid GitHub issue number");
  }

  const [owner, name] = normalizedRepo.split("/");
  const octokit = new Octokit({ auth: token });
  const current = await octokit.issues.get({
    owner,
    repo: name,
    issue_number: issueNumber,
  });
  if ("pull_request" in current.data) {
    throw new Error("GitHub pull requests cannot be moved on the issue board");
  }

  const labels = labelsFrom(current.data).filter(
    (label) => !isInProgressLabel(label),
  );
  if (targetStatus === "in_progress") {
    labels.push(await repoInProgressLabel(octokit, token, normalizedRepo));
  }

  const state = targetStatus === "resolved" ? "closed" : "open";
  const updated = await octokit.issues.update({
    owner,
    repo: name,
    issue_number: issueNumber,
    state,
    ...(state === "closed" ? { state_reason: "completed" as const } : {}),
    labels,
  });
  const result = linkedIssueFromGitHub(normalizedRepo, updated.data);
  if (result.displayStatus !== targetStatus) {
    throw Object.assign(
      new Error(
        "GitHub accepted the request but did not apply the issue status change",
      ),
      { status: 403 },
    );
  }
  const projectStatus = await updateLinkedProjectStatuses(
    octokit,
    current.data.node_id,
    targetStatus,
  );
  return { issue: result, projectStatus };
}

/** Add or remove one repository-owned label without replacing concurrent labels. */
export async function updateGitHubIssueLabel(
  token: string,
  repo: string,
  issueNumber: number,
  label: string,
  operation: GitHubIssueLabelOperation,
): Promise<LinkedIssueStatus> {
  const normalizedRepo = normalizeGitHubRepo(repo);
  const normalizedLabel = label.trim();
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("Invalid GitHub issue number");
  }
  if (!normalizedLabel || normalizedLabel.length > 50) {
    throw new Error("Invalid GitHub issue label");
  }

  const [owner, name] = normalizedRepo.split("/");
  const octokit = new Octokit({ auth: token });
  if (operation === "add") {
    await octokit.issues.addLabels({
      owner,
      repo: name,
      issue_number: issueNumber,
      labels: [normalizedLabel],
    });
  } else {
    await octokit.issues.removeLabel({
      owner,
      repo: name,
      issue_number: issueNumber,
      name: normalizedLabel,
    });
  }

  const updated = await octokit.issues.get({
    owner,
    repo: name,
    issue_number: issueNumber,
  });
  if ("pull_request" in updated.data) {
    throw new Error("GitHub pull requests cannot be updated on the issue board");
  }
  return linkedIssueFromGitHub(normalizedRepo, updated.data);
}

/**
 * List every issue (open and closed) from the attached repositories.
 * GitHub's repository issue endpoint is paginated without the Search API's
 * 1,000-result ceiling. Pull requests are excluded because GitHub returns
 * them from the same REST endpoint.
 */
export async function listIssuesAcrossRepos(
  token: string,
  repos: string[],
  _options: { refresh?: boolean } = {},
): Promise<LinkedIssueStatus[]> {
  const cleanRepos = [...new Set(repos.map(normalizeGitHubRepo))];
  if (!cleanRepos.length) return [];
  const octokit = new Octokit({ auth: token });
  const pages = await mapWithConcurrency(cleanRepos, 5, async (repo) => {
    const [owner, name] = repo.split("/");
    const items = await octokit.paginate(octokit.issues.listForRepo, {
      owner,
      repo: name,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });
    return items
      .filter((item) => !("pull_request" in item))
      .map((item) => linkedIssueFromGitHub(repo, item));
  });
  return pages
    .flat()
    .sort((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    );
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
