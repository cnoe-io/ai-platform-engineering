/**
 * Project scope and credentials for TOME's upstream GitHub issue view.
 * Issue content is never persisted here; only project/repository scope and a
 * delegated credential are resolved.
 */

import { getCollection } from "@/lib/mongodb";
import { githubFullName } from "@/lib/projects/github-repository";
import { filterReadableTomeProjects } from "@/lib/tome/access";
import {
  resolveCredentialsForSub,
  resolveForwardedCredentials,
  type ForwardedCredentials,
} from "@/lib/tome/agent-proxy";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import type { TomeProjectContext } from "@/lib/tome/tome-api";
import { dataStewardUserEmail, type ProjectDocument } from "@/types/projects";

export type TomeProjectRow = ProjectDocument & { _id: unknown };

export function selectTomeRollupProjects(
  current: ProjectDocument,
  all: TomeProjectRow[],
): TomeProjectRow[] {
  const bySlug = new Map(all.map((project) => [project.slug, project]));
  const selected = new Set<string>([current.slug]);
  if (current.type === "area") {
    for (const project of all) {
      if ((project.labels?.areas ?? []).includes(current.slug)) {
        selected.add(project.slug);
      }
    }
  } else if (current.type === "bhag") {
    const areaSlugs = new Set<string>();
    for (const project of all) {
      if (
        project.type === "area" &&
        (project.labels?.initiatives ?? []).includes(current.slug)
      ) {
        selected.add(project.slug);
        areaSlugs.add(project.slug);
      }
    }
    for (const project of all) {
      const directlyTagged = (project.labels?.initiatives ?? []).includes(
        current.slug,
      );
      const inChildArea = (project.labels?.areas ?? []).some((area) =>
        areaSlugs.has(area),
      );
      if (directlyTagged || inChildArea) selected.add(project.slug);
    }
  }
  return [...selected]
    .map((slug) => bySlug.get(slug))
    .filter((project): project is TomeProjectRow => Boolean(project));
}

export function projectGitHubRepos(project: ProjectDocument): string[] {
  const values = project.sources?.github_repos?.length
    ? project.sources.github_repos.map(
        (repo) => repo.full_name || repo.html_url,
      )
    : (project.sources?.repos ?? []);
  const repos = values
    .map(githubFullName)
    .filter((repo) => repo.split("/").filter(Boolean).length === 2);
  return [...new Set(repos)];
}

export async function readableTomeRollupProjects(
  ctx: TomeProjectContext,
): Promise<TomeProjectRow[]> {
  const projects = await getCollection<TomeProjectRow>("projects");
  const allProjects = await projects.find({}).toArray();
  const readable = (await filterReadableTomeProjects(
    tomeSessionSubject(ctx.session),
    allProjects,
    { isAdmin: ctx.canManageSteward },
  )) as TomeProjectRow[];
  if (!readable.some((project) => project.slug === ctx.project.slug)) {
    readable.push(ctx.project as TomeProjectRow);
  }
  return selectTomeRollupProjects(ctx.project, readable);
}

export function rollupGitHubRepos(projects: TomeProjectRow[]): string[] {
  return [...new Set(projects.flatMap(projectGitHubRepos))];
}

async function subjectForEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return "";
  const users = await getCollection<{
    email?: string;
    keycloak_sub?: string;
    metadata?: { keycloak_sub?: string };
  }>("users");
  const user = await users.findOne({ email: normalized });
  return user?.keycloak_sub || user?.metadata?.keycloak_sub || "";
}

export interface TomeGitHubCredential {
  token?: string;
  source: "deployment" | "data_steward" | "requester" | "missing";
  ownerEmail?: string;
}

export async function resolveTomeGitHubCredential(
  ctx: TomeProjectContext,
): Promise<TomeGitHubCredential> {
  const deploymentToken = process.env.TOME_GITHUB_TOKEN?.trim();
  if (deploymentToken) return { token: deploymentToken, source: "deployment" };

  const stewardEmail = dataStewardUserEmail(ctx.project.data_steward);
  if (stewardEmail) {
    const stewardSub = await subjectForEmail(stewardEmail);
    const stewardCredentials = await resolveCredentialsForSub(stewardSub).catch(
      (): ForwardedCredentials => ({}),
    );
    const stewardToken = stewardCredentials.github?.access_token;
    if (stewardToken) {
      return {
        token: stewardToken,
        source: "data_steward",
        ownerEmail: stewardEmail,
      };
    }
  }

  const requesterCredentials = await resolveForwardedCredentials(ctx).catch(
    (): ForwardedCredentials => ({}),
  );
  const requesterToken = requesterCredentials.github?.access_token;
  if (requesterToken) return { token: requesterToken, source: "requester" };
  return { source: "missing" };
}

/**
 * Resolve the sole identity authorized to mutate upstream issues. This mirrors
 * autonomous ingestion: writes run with the explicitly assigned data
 * steward's delegated connection, never a deployment or requester's token.
 */
export async function resolveTomeGitHubWriteCredential(
  ctx: TomeProjectContext,
): Promise<TomeGitHubCredential> {
  const ownerEmail = dataStewardUserEmail(ctx.project.data_steward);
  if (!ownerEmail) return { source: "missing" };

  const stewardSub = await subjectForEmail(ownerEmail);
  if (!stewardSub) return { source: "missing", ownerEmail };
  const credentials = await resolveCredentialsForSub(stewardSub).catch(
    (): ForwardedCredentials => ({}),
  );
  const token = credentials.github?.access_token;
  return token
    ? { token, source: "data_steward", ownerEmail }
    : { source: "missing", ownerEmail };
}
