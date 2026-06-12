/**
 * Maps CAIPE project state into the reused TTT agent's wire contract
 * (`orchestrator/contract.py`). The agent is snapshot-driven: the backend
 * resolves everything it needs once and ships it in the request body, so the
 * agent never looks anything up itself.
 *
 * This is the CAIPE half of Option B2 (PORT_PLAN.md §Agent layer): instead of
 * TTT's own DB, the snapshot comes from `ProjectDocument` + the tome PageStore.
 *
 * Server-only.
 */

import { getPageStore } from "./page-store";
import { stablePathsIn } from "./schema";
import type { TomeProjectContext } from "./tome-api";
import type { ProjectDocument } from "@/types/projects";

/** RepoSnapshot — mirrors contract.RepoSnapshot. */
interface RepoSnapshot {
  slug: string;
  url: string;
  default_branch: string;
}

/** ProjectSnapshot — mirrors contract.ProjectSnapshot. */
interface ProjectSnapshot {
  project_id: string;
  name: string;
  charter: string;
  phase: string | null;
  cadence: string | null;
  repos: RepoSnapshot[];
  webex_rooms: never[];
  confluence_spaces: never[];
}

/** ChatRequest — mirrors contract.ChatRequest. */
export interface AgentChatRequest {
  message: string;
  sdk_session_id: string | null;
  snapshot: ProjectSnapshot;
  stable_pages: Record<string, string>;
  role: "viewer" | "editor";
}

/** Derive a short slug from a repo URL or `owner/name` string. */
function repoSlug(repo: string): string {
  const trimmed = repo.replace(/\.git$/, "").replace(/\/$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

function toRepoSnapshot(repo: string): RepoSnapshot {
  const url = /^https?:\/\//.test(repo)
    ? repo
    : `https://github.com/${repo.replace(/^\/+/, "")}`;
  return { slug: repoSlug(repo), url, default_branch: "main" };
}

/**
 * Build the agent `ProjectSnapshot` from a CAIPE `ProjectDocument`.
 * charter ← `project.description` (decision A); repos ← `sources.repos`.
 */
export function buildSnapshotFromProject(
  project: ProjectDocument & { _id: string },
): ProjectSnapshot {
  return {
    project_id: project._id,
    name: project.title || project.name,
    charter: project.description ?? "",
    phase: null,
    cadence: null,
    repos: (project.sources?.repos ?? []).map(toRepoSnapshot),
    webex_rooms: [],
    confluence_spaces: [],
  };
}

export function buildSnapshot(ctx: TomeProjectContext): ProjectSnapshot {
  return buildSnapshotFromProject(ctx.project);
}

/** Resolve the project's current stable pages (`path -> markdown`). */
export async function loadStablePages(
  projectId: string,
): Promise<Record<string, string>> {
  const store = await getPageStore();
  const pages = await store.listPages(projectId);
  const stable = stablePathsIn(pages);
  const out: Record<string, string> = {};
  for (const path of stable) out[path] = pages[path];
  return out;
}

/** Assemble the agent `ChatRequest` for one chat turn. */
export async function buildChatRequest(
  ctx: TomeProjectContext,
  opts: { message: string; sdkSessionId: string | null },
): Promise<AgentChatRequest> {
  return {
    message: opts.message,
    sdk_session_id: opts.sdkSessionId,
    snapshot: buildSnapshot(ctx),
    stable_pages: await loadStablePages(ctx.projectId),
    role: ctx.canEdit ? "editor" : "viewer",
  };
}
