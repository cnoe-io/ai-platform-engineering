/**
 * Thin GitHub REST client wrapper for the Agentic SDLC.
 *
 * Wraps `@octokit/rest` Octokit with three concerns:
 *   1. Per-call user-token construction (we don't keep an installation
 *      token store at this stage; tokens come from the caller's GitHub
 *      OAuth session, fetched from the auth helpers in `auth.ts`).
 *   2. Defensive timeouts and error-shape normalisation — every helper
 *      throws a `GitHubClientError` rather than leaking Octokit's error
 *      shape into route handlers.
 *   3. The four operations the Agentic SDLC needs:
 *        - listRepoWebhooks
 *        - createRepoWebhook
 *        - deleteRepoWebhook
 *        - getRepoMetadata (to derive default_branch and confirm access)
 *
 * Does NOT pin or pre-validate the user's permission — callers must use
 * `authz.ts#requireRepoAccess` before invoking any mutating method.
 *
 * Server-only module.
 */

import { Octokit } from "@octokit/rest";

export type GitHubClientErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "validation_failed"
  | "network"
  | "timeout"
  | "unknown";

export class GitHubClientError extends Error {
  readonly code: GitHubClientErrorCode;
  readonly status: number | null;
  /** GitHub-supplied documentation URL when present. */
  readonly documentationUrl: string | null;

  constructor(
    message: string,
    code: GitHubClientErrorCode,
    status: number | null = null,
    documentationUrl: string | null = null,
  ) {
    super(message);
    this.name = "GitHubClientError";
    this.code = code;
    this.status = status;
    this.documentationUrl = documentationUrl;
  }
}

export interface RepoWebhook {
  id: number;
  url: string;
  active: boolean;
  events: string[];
  config: {
    url?: string;
    content_type?: string;
    insecure_ssl?: string;
    secret?: string;
  };
}

export interface RepoMetadata {
  id: number;
  full_name: string;
  default_branch: string;
  permissions?: {
    admin?: boolean;
    push?: boolean;
    pull?: boolean;
  };
}

export interface RepoIssue {
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: { name?: string }[];
  assignees: { login?: string }[];
  html_url: string;
  updated_at: string | null;
  pull_request?: unknown;
  sub_issues_summary?: { total?: number };
}

export interface RepoPullRequest {
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged: boolean;
  labels: { name?: string }[];
  assignees: { login?: string }[];
  requested_reviewers: { login?: string }[];
  html_url: string;
  updated_at: string | null;
}

export interface GitHubClientConfig {
  /** OAuth user token from the caller's session. */
  authToken: string;
  /** Override base URL for GHE deployments. Defaults to api.github.com. */
  baseUrl?: string;
  /** Defaults to 10s. Max 30s. */
  timeoutMs?: number;
}

export interface IGitHubClient {
  listRepoWebhooks(owner: string, repo: string): Promise<RepoWebhook[]>;
  createRepoWebhook(
    owner: string,
    repo: string,
    config: {
      callbackUrl: string;
      secret: string;
      events: string[];
    },
  ): Promise<RepoWebhook>;
  deleteRepoWebhook(
    owner: string,
    repo: string,
    hookId: number,
  ): Promise<void>;
  getRepoMetadata(owner: string, repo: string): Promise<RepoMetadata>;
  listRepoIssues(
    owner: string,
    repo: string,
    opts: { state: "open" | "closed" | "all"; perPage: number },
  ): Promise<RepoIssue[]>;
  listIssueSubIssues(
    owner: string,
    repo: string,
    issueNumber: number,
    opts: { perPage: number },
  ): Promise<RepoIssue[]>;
  listRepoPullRequests(
    owner: string,
    repo: string,
    opts: { state: "open" | "closed" | "all"; perPage: number },
  ): Promise<RepoPullRequest[]>;
}

export function createGitHubClient(cfg: GitHubClientConfig): IGitHubClient {
  if (!cfg.authToken) {
    throw new GitHubClientError(
      "missing GitHub auth token",
      "unauthorized",
      401,
    );
  }

  const timeoutMs = Math.min(Math.max(cfg.timeoutMs ?? 10_000, 1_000), 30_000);
  const octokit = new Octokit({
    auth: cfg.authToken,
    baseUrl: cfg.baseUrl,
    request: {
      timeout: timeoutMs,
    },
  });

  return {
    async listRepoWebhooks(owner, repo) {
      try {
        const res = await octokit.repos.listWebhooks({
          owner,
          repo,
          per_page: 100,
        });
        return res.data.map((h) => ({
          id: h.id,
          url: h.url,
          active: h.active,
          events: h.events,
          config: {
            url: h.config?.url,
            content_type: h.config?.content_type,
            insecure_ssl: h.config?.insecure_ssl as string | undefined,
            // never expose secret
          },
        }));
      } catch (err) {
        throw normaliseError(err);
      }
    },

    async createRepoWebhook(owner, repo, config) {
      try {
        const res = await octokit.repos.createWebhook({
          owner,
          repo,
          name: "web",
          active: true,
          events: config.events,
          config: {
            url: config.callbackUrl,
            content_type: "json",
            secret: config.secret,
            insecure_ssl: "0",
          },
        });
        return {
          id: res.data.id,
          url: res.data.url,
          active: res.data.active,
          events: res.data.events,
          config: {
            url: res.data.config?.url,
            content_type: res.data.config?.content_type,
          },
        };
      } catch (err) {
        throw normaliseError(err);
      }
    },

    async deleteRepoWebhook(owner, repo, hookId) {
      try {
        await octokit.repos.deleteWebhook({
          owner,
          repo,
          hook_id: hookId,
        });
      } catch (err) {
        throw normaliseError(err);
      }
    },

    async getRepoMetadata(owner, repo) {
      try {
        const res = await octokit.repos.get({ owner, repo });
        return {
          id: res.data.id,
          full_name: res.data.full_name,
          default_branch: res.data.default_branch,
          permissions: res.data.permissions
            ? {
                admin: res.data.permissions.admin,
                push: res.data.permissions.push,
                pull: res.data.permissions.pull,
              }
            : undefined,
        };
      } catch (err) {
        throw normaliseError(err);
      }
    },

    async listRepoIssues(owner, repo, opts) {
      try {
        const issues = await octokit.paginate(octokit.issues.listForRepo, {
          owner,
          repo,
          state: opts.state,
          per_page: opts.perPage,
          sort: "updated",
          direction: "desc",
        });
        return issues.map((issue) => ({
          node_id: issue.node_id,
          number: issue.number,
          title: issue.title,
          body: issue.body ?? null,
          state: issue.state as "open" | "closed",
          labels: issue.labels
            .map((label) =>
              typeof label === "string" ? { name: label } : { name: label.name },
            )
            .filter((label) => typeof label.name === "string"),
          assignees: (issue.assignees ?? []).map((assignee) => ({
            login: assignee.login,
          })),
          html_url: issue.html_url,
          updated_at: issue.updated_at ?? null,
          pull_request: issue.pull_request,
          sub_issues_summary: (
            issue as typeof issue & { sub_issues_summary?: { total?: number } }
          ).sub_issues_summary,
        }));
      } catch (err) {
        throw normaliseError(err);
      }
    },

    async listIssueSubIssues(owner, repo, issueNumber, opts) {
      try {
        const subIssues = await octokit.paginate(
          "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
          {
            owner,
            repo,
            issue_number: issueNumber,
            per_page: opts.perPage,
          },
        );
        return subIssues.map((issue) => ({
          node_id: issue.node_id,
          number: issue.number,
          title: issue.title,
          body: issue.body ?? null,
          state: issue.state as "open" | "closed",
          labels: issue.labels
            .map((label) =>
              typeof label === "string" ? { name: label } : { name: label.name },
            )
            .filter((label) => typeof label.name === "string"),
          assignees: (issue.assignees ?? []).map((assignee) => ({
            login: assignee.login,
          })),
          html_url: issue.html_url,
          updated_at: issue.updated_at ?? null,
          pull_request: issue.pull_request,
          sub_issues_summary: (
            issue as typeof issue & { sub_issues_summary?: { total?: number } }
          ).sub_issues_summary,
        }));
      } catch (err) {
        throw normaliseError(err);
      }
    },

    async listRepoPullRequests(owner, repo, opts) {
      try {
        const pulls = await octokit.paginate(octokit.pulls.list, {
          owner,
          repo,
          state: opts.state,
          per_page: opts.perPage,
          sort: "updated",
          direction: "desc",
        });
        return pulls.map((pull) => ({
          node_id: pull.node_id,
          number: pull.number,
          title: pull.title,
          body: pull.body ?? null,
          state: pull.state as "open" | "closed",
          merged: Boolean(pull.merged_at),
          labels: pull.labels
            .map((label) => ({ name: label.name }))
            .filter((label) => typeof label.name === "string"),
          assignees: (pull.assignees ?? []).map((assignee) => ({
            login: assignee.login,
          })),
          requested_reviewers: (pull.requested_reviewers ?? []).map((reviewer) => ({
            login: "login" in reviewer ? reviewer.login : undefined,
          })),
          html_url: pull.html_url,
          updated_at: pull.updated_at ?? null,
        }));
      } catch (err) {
        throw normaliseError(err);
      }
    },
  };
}

function normaliseError(err: unknown): GitHubClientError {
  if (err instanceof GitHubClientError) return err;
  // Octokit RequestError shape:
  // { name: "HttpError", status, response: { data: { message, documentation_url } } }
  const e = err as {
    status?: number;
    message?: string;
    response?: {
      data?: { message?: string; documentation_url?: string };
    };
    code?: string;
  };
  const status = typeof e?.status === "number" ? e.status : null;
  const docs = e?.response?.data?.documentation_url ?? null;
  const message = e?.response?.data?.message ?? e?.message ?? "GitHub error";

  if (e?.code === "ETIMEDOUT" || e?.code === "ECONNABORTED") {
    return new GitHubClientError(message, "timeout", status, docs);
  }
  if (status === 401) {
    return new GitHubClientError(message, "unauthorized", status, docs);
  }
  if (status === 403) {
    if (
      typeof e?.response?.data?.message === "string" &&
      /rate limit/i.test(e.response.data.message)
    ) {
      return new GitHubClientError(message, "rate_limited", status, docs);
    }
    return new GitHubClientError(message, "forbidden", status, docs);
  }
  if (status === 404) {
    return new GitHubClientError(message, "not_found", status, docs);
  }
  if (status === 422) {
    return new GitHubClientError(message, "validation_failed", status, docs);
  }
  if (status === null) {
    return new GitHubClientError(message, "network", null, docs);
  }
  return new GitHubClientError(message, "unknown", status, docs);
}
