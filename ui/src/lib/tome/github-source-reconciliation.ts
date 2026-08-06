/**
 * Canonicalize attached GitHub repositories before Tome reads them.
 *
 * GitHub's numeric repository ID is durable across owner/name changes. The
 * mutable metadata is refreshed for every ingest, then obsolete
 * `repos/<slug>/` pages are tombstoned so stale source content cannot remain
 * visible as if it were current. Tombstones preserve the complete page
 * revision history.
 */

import {
  githubFullName,
  githubRepoSlug,
  githubSourceFromValue,
} from "@/lib/projects/github-repository";
import { getCollection } from "@/lib/mongodb";
import type {
  GitHubRepositorySource,
  ProjectDocument,
  ProjectSources,
} from "@/types/projects";

import type { ForwardedCredentials } from "./agent-proxy";
import { getPageStore } from "./page-store";

const GITHUB_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

interface GitHubRepositoryResponse {
  id?: number;
  node_id?: string;
  full_name?: string;
  html_url?: string;
  default_branch?: string;
}

export interface GitHubSourceReconciliationResult {
  project: ProjectDocument & { _id: string };
  canonicalized: Array<{ from: string; to: string }>;
  tombstonedPaths: string[];
}

export interface ReconciliationDependencies {
  fetchImpl: typeof fetch;
  listPages: (projectId: string) => Promise<Record<string, string>>;
  deletePage: (projectId: string, path: string) => Promise<void>;
  persistSources: (projectId: string, sources: ProjectSources) => Promise<void>;
}

function configuredGitHubSources(project: ProjectDocument): GitHubRepositorySource[] {
  if (project.sources?.github_repos?.length) {
    return project.sources.github_repos;
  }
  return (project.sources?.repos ?? []).map(githubSourceFromValue);
}

function repositoryApiUrl(source: GitHubRepositorySource): string {
  if (typeof source.id === "number") {
    return `https://api.github.com/repositories/${source.id}`;
  }
  const fullName = githubFullName(source.full_name || source.html_url);
  const [owner, repo, ...extra] = fullName.split("/");
  if (!owner || !repo || extra.length > 0) {
    throw new Error(`Invalid GitHub repository source: ${source.full_name || source.html_url}`);
  }
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** Resolve stable identity plus current canonical GitHub metadata. */
export async function resolveCanonicalGitHubSources(
  sources: GitHubRepositorySource[],
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubRepositorySource[]> {
  if (sources.length === 0) return [];
  if (!token) {
    throw new Error(
      "GitHub source resolution requires a connected GitHub account; reconnect it and retry the ingest",
    );
  }

  const resolved = await Promise.all(
    sources.map(async (source) => {
      const ref = source.full_name || source.html_url;
      const response = await fetchImpl(repositoryApiUrl(source), {
        headers: GITHUB_HEADERS(token),
        redirect: "follow",
      });
      if (!response.ok) {
        throw new Error(
          `GitHub source ${ref} could not be resolved (${response.status}); stale wiki content was not treated as current`,
        );
      }
      const repo = (await response.json()) as GitHubRepositoryResponse;
      if (
        typeof repo.id !== "number" ||
        !repo.full_name ||
        !repo.html_url ||
        !repo.default_branch
      ) {
        throw new Error(
          `GitHub source ${ref} returned incomplete canonical metadata; retry after reconnecting GitHub`,
        );
      }
      return {
        id: repo.id,
        ...(repo.node_id ? { node_id: repo.node_id } : {}),
        full_name: repo.full_name,
        html_url: repo.html_url,
        default_branch: repo.default_branch,
      } satisfies GitHubRepositorySource;
    }),
  );

  const seen = new Set<number>();
  return resolved.filter((source) => {
    if (source.id === undefined || seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}

/** Return live paths belonging to repo subtrees that are no longer attached. */
export function obsoleteRepoPagePaths(
  pages: Record<string, string>,
  canonicalSources: GitHubRepositorySource[],
): string[] {
  const active = new Set(
    canonicalSources.map((source) => githubRepoSlug(source).toLowerCase()),
  );
  return Object.keys(pages)
    .filter((path) => {
      const match = path.match(/^repos\/([^/]+)\//);
      return Boolean(match && !active.has(match[1].toLowerCase()));
    })
    .sort();
}

async function defaultDependencies(): Promise<ReconciliationDependencies> {
  const store = await getPageStore();
  return {
    fetchImpl: fetch,
    listPages: (projectId) => store.listPages(projectId),
    deletePage: (projectId, path) =>
      store.deletePage(projectId, path, {
        author: "tome-ingest",
        message: "tombstone obsolete GitHub source subtree",
      }),
    persistSources: async (projectId, sources) => {
      const { ObjectId } = await import("mongodb");
      const projects = await getCollection<ProjectDocument>("projects");
      const _id = ObjectId.isValid(projectId)
        ? (new ObjectId(projectId) as unknown as string)
        : projectId;
      await projects.updateOne(
        { _id },
        { $set: { sources, updated_at: new Date() } },
      );
    },
  };
}

/**
 * Reconcile one project's GitHub configuration and persisted wiki before a run.
 * Dependencies are injectable so rename, cleanup, and persistence semantics can
 * be tested without MongoDB.
 */
export async function reconcileGitHubSourcesForIngest(
  project: ProjectDocument & { _id: string },
  credentials: ForwardedCredentials,
  dependencies?: ReconciliationDependencies,
): Promise<GitHubSourceReconciliationResult> {
  const configured = configuredGitHubSources(project);
  const deps = dependencies ?? (await defaultDependencies());
  const canonical = await resolveCanonicalGitHubSources(
    configured,
    credentials.github?.access_token ?? "",
    deps.fetchImpl,
  );
  const pages = await deps.listPages(project._id);
  const tombstonedPaths = obsoleteRepoPagePaths(pages, canonical);
  await Promise.all(
    tombstonedPaths.map((path) => deps.deletePage(project._id, path)),
  );

  const canonicalized = canonical.flatMap((source, index) => {
    const prior = configured[index];
    return prior &&
      (prior.full_name !== source.full_name || prior.html_url !== source.html_url)
      ? [{ from: prior.full_name || prior.html_url, to: source.full_name }]
      : [];
  });
  const sources: ProjectSources = {
    ...(project.sources ?? {}),
    github_repos: canonical,
    repos: canonical.map((source) => source.html_url),
  };
  const hadConfiguredRepos =
    (project.sources?.github_repos?.length ?? 0) > 0 ||
    (project.sources?.repos?.length ?? 0) > 0;
  if (hadConfiguredRepos || tombstonedPaths.length > 0) {
    await deps.persistSources(project._id, sources);
  }

  return {
    project:
      hadConfiguredRepos || tombstonedPaths.length > 0
        ? { ...project, sources }
        : project,
    canonicalized,
    tombstonedPaths,
  };
}
