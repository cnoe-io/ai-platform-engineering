/**
 * Maps CAIPE project state into the tome agent's wire contract
 * (`orchestrator/contract.py`). The agent is snapshot-driven: the backend
 * resolves everything it needs once and ships it in the request body, so the
 * agent never looks anything up itself. The snapshot comes from
 * `ProjectDocument` + the tome PageStore.
 *
 * Server-only.
 */

import { collectForwardedCredentials } from "@/lib/projects/onboarding-providers";
import { webexRoomSlug } from "@/lib/projects/webex-room";

import { resolveBhagChildren } from "./bhag";
import { getPageStore } from "./page-store";
import { stablePathsIn } from "./schema";
import type { TomeProjectContext } from "./tome-api";
import type { ProjectDocument } from "@/types/projects";

/**
 * Wire shape for forwarded user credentials. The agent reads these off the
 * request and routes them to the right MCP per-call. Values are strings on
 * the wire (incl. `expires_in`); the agent parses defensively.
 */
export type ForwardedCredentials = Record<string, Record<string, string>>;

/** Providers we recognize as "tome connectors" — matches MCP slugs on the agent. */
type Provider = "github" | "atlassian" | "webex";

/** All providers the agent understands. We always resolve all of them — the
 * credential store returns nothing for providers the user hasn't connected,
 * so subsetting by project sources is unnecessary gatekeeping. */
const ALL_PROVIDERS: Provider[] = ["github", "atlassian", "webex"];

/** Extract the OIDC `sub` from a session for credential lookup; "" if unknown. */
export function sessionSub(session: unknown): string {
  if (session && typeof session === "object" && "sub" in session) {
    const sub = (session as { sub?: unknown }).sub;
    if (typeof sub === "string" && sub.trim()) return sub.trim();
  }
  return "";
}

/**
 * Resolve a user's forwarded credentials directly from their OIDC `sub`. The
 * queue worker uses this to re-resolve creds when it starts a previously-queued
 * run (the original request session is gone by then). Returns `{}` for an empty
 * sub or a user with nothing connected.
 */
export async function resolveCredentialsForSub(
  sub: string,
): Promise<ForwardedCredentials> {
  if (!sub) return {};
  return collectForwardedCredentials(sub, ALL_PROVIDERS);
}

/**
 * Resolve the requesting user's forwarded credentials for the providers this
 * project's sources need. Exported so the ingest path can resolve them
 * synchronously before its async task runs (by which point the session is
 * gone). Returns `{}` when nothing applies.
 */
export async function resolveForwardedCredentials(
  ctx: TomeProjectContext,
): Promise<ForwardedCredentials> {
  return resolveCredentialsForSub(sessionSub(ctx.session));
}

/** RepoSnapshot — mirrors contract.RepoSnapshot. */
interface RepoSnapshot {
  slug: string;
  url: string;
  default_branch: string;
}

/** ConfluenceSpaceSnapshot — mirrors contract.ConfluenceSpaceSnapshot. */
interface ConfluenceSpaceSnapshot {
  slug: string;
  name: string;
  space_key: string;
  base_url: string;
}

/** WebexRoomSnapshot — mirrors contract.WebexRoomSnapshot. */
interface WebexRoomSnapshot {
  slug: string;
  name: string;
  room_id: string;
}

/** ChildProjectSnapshot — mirrors contract.ChildProjectSnapshot. */
interface ChildProjectSnapshot {
  project_id: string;
  slug: string;
  name: string;
}

/** ProjectSnapshot — mirrors contract.ProjectSnapshot. */
interface ProjectSnapshot {
  project_id: string;
  slug: string;
  name: string;
  charter: string;
  phase: string | null;
  cadence: string | null;
  project_type: "project" | "bhag";
  repos: RepoSnapshot[];
  webex_rooms: WebexRoomSnapshot[];
  confluence_spaces: ConfluenceSpaceSnapshot[];
  child_projects: ChildProjectSnapshot[];
}

/** ChatRequest — mirrors contract.ChatRequest. */
export interface AgentChatRequest {
  message: string;
  sdk_session_id: string | null;
  snapshot: ProjectSnapshot;
  stable_pages: Record<string, string>;
  role: "viewer" | "editor";
  /**
   * Per-request OAuth credentials forwarded from CAIPE's connection store. The
   * agent forwards each provider's `access_token` to the matching MCP. Empty
   * when the user hasn't connected a relevant provider or no source is attached.
   */
  credentials: ForwardedCredentials;
}

/** IngestRequest — mirrors contract.IngestRequest. */
export interface AgentIngestRequest {
  run_id: string;
  seed: string | null;
  connector_data: Record<string, unknown>;
  snapshot: ProjectSnapshot;
  is_greenfield: boolean;
  /**
   * Opt-in (default false), greenfield only. Authorizes the agent to write a
   * best-effort DRAFT into the stable pages (charter/objectives/roadmap).
   * When false, stable pages stay human-owned and untouched.
   */
  seed_stable_pages: boolean;
  report_id: string;
  /** Same as `AgentChatRequest.credentials`. */
  credentials: ForwardedCredentials;
}

function toWebexRoomSnapshot(
  r: NonNullable<ProjectDocument["sources"]>["webex_rooms"] extends
    | (infer Item)[]
    | undefined
    ? Item
    : never,
): WebexRoomSnapshot {
  const slug = r.slug?.trim() || webexRoomSlug(r.name, r.room_id);
  return { slug, name: r.name, room_id: r.room_id };
}

/** Resolve the project's Webex rooms as snapshot entries (typed `webex_rooms`). */
function projectWebexRooms(project: ProjectDocument): WebexRoomSnapshot[] {
  return (project.sources?.webex_rooms ?? []).map(toWebexRoomSnapshot);
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

function toConfluenceSpaceSnapshot(
  s: NonNullable<ProjectDocument["sources"]>["confluence_spaces"] extends
    | (infer Item)[]
    | undefined
    ? Item
    : never,
): ConfluenceSpaceSnapshot {
  return {
    slug: s.slug,
    name: s.name,
    space_key: s.space_key,
    base_url: s.base_url ?? "",
  };
}

/** Slugify a Confluence space key for use as a wiki folder name. */
function spaceSlug(key: string): string {
  return (
    key
      .normalize("NFKD")
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || key
  );
}

/**
 * Parse a Confluence space URL into a snapshot entry. The wizard stores the
 * user's pick as a single `confluence_url`
 * (`https://<site>/wiki/spaces/<KEY>/...`); the agent snapshot needs a typed
 * `{slug, name, space_key, base_url}`. Returns null if no space key is present.
 */
function parseConfluenceSpaceUrl(url: string): ConfluenceSpaceSnapshot | null {
  const trimmed = (url || "").trim();
  if (!trimmed) return null;
  const m = trimmed.match(/\/wiki\/spaces\/([^/?#]+)/i);
  if (!m) return null;
  const key = decodeURIComponent(m[1]);
  let baseUrl = "";
  try {
    baseUrl = new URL(trimmed).origin;
  } catch {
    /* leave base_url empty on unparseable input */
  }
  // Display name is unknown at this layer (we only have the URL); the agent
  // resolves the real space name via the MCP. Use the key as a placeholder.
  return { slug: spaceSlug(key), name: key, space_key: key, base_url: baseUrl };
}

/**
 * The project's Confluence spaces as snapshot entries. Prefers a typed
 * `confluence_spaces` array; falls back to parsing the legacy single
 * `confluence_url` the wizard writes today.
 */
function projectConfluenceSpaces(
  project: ProjectDocument,
): ConfluenceSpaceSnapshot[] {
  const typed = project.sources?.confluence_spaces ?? [];
  if (typed.length > 0) return typed.map(toConfluenceSpaceSnapshot);
  const fromUrl = parseConfluenceSpaceUrl(project.sources?.confluence_url ?? "");
  return fromUrl ? [fromUrl] : [];
}

/**
 * Build the agent `ProjectSnapshot` from a CAIPE `ProjectDocument`.
 * charter ← `project.description` (decision A); repos ← `sources.repos`.
 */
export function buildSnapshotFromProject(
  project: ProjectDocument & { _id: string },
): ProjectSnapshot {
  const isBhag = project.type === "bhag";
  return {
    project_id: project._id,
    slug: project.slug,
    name: project.title || project.name,
    charter: project.description ?? "",
    phase: null,
    cadence: null,
    project_type: isBhag ? "bhag" : "project",
    // A BHAG has no connectors — sources are empty regardless of any stale data.
    repos: isBhag ? [] : (project.sources?.repos ?? []).map(toRepoSnapshot),
    webex_rooms: isBhag ? [] : projectWebexRooms(project),
    confluence_spaces: isBhag ? [] : projectConfluenceSpaces(project),
    child_projects: [],
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
  const [stablePages, credentials] = await Promise.all([
    loadStablePages(ctx.projectId),
    resolveForwardedCredentials(ctx),
  ]);
  const snapshot = buildSnapshot(ctx);
  // A BHAG has no sources of its own — its "context" is the wikis of its tagged
  // child projects. Carry them so chat can read across them (the agent widens
  // its read fence to the children's on-disk wikis).
  if (ctx.project.type === "bhag") {
    snapshot.child_projects = await resolveBhagChildren(ctx.project.name);
  }
  return {
    message: opts.message,
    sdk_session_id: opts.sdkSessionId,
    snapshot,
    stable_pages: stablePages,
    role: ctx.canEdit ? "editor" : "viewer",
    credentials,
  };
}

/**
 * Assemble the agent `IngestRequest` for one ingest run.
 *
 * `driveIngest` fires after the HTTP response returns, so credentials must be
 * resolved synchronously by the caller and passed in via `opts.credentials`.
 * For chat we just call `resolveForwardedCredentials` here; for ingest, the route
 * resolves them before async dispatch.
 */
export function buildIngestRequest(
  project: ProjectDocument & { _id: string },
  opts: {
    runId: string;
    reportId: string;
    seed: string | null;
    isGreenfield: boolean;
    connectorData?: Record<string, unknown>;
    credentials?: ForwardedCredentials;
    seedStablePages?: boolean;
    /** BHAG only: the projects tagged to this goal, to synthesize. */
    childProjects?: ChildProjectSnapshot[];
  },
): AgentIngestRequest {
  const snapshot = buildSnapshotFromProject(project);
  if (opts.childProjects?.length) {
    snapshot.child_projects = opts.childProjects;
  }
  return {
    run_id: opts.runId,
    report_id: opts.reportId,
    seed: opts.seed,
    connector_data: opts.connectorData ?? {},
    snapshot,
    is_greenfield: opts.isGreenfield,
    seed_stable_pages: opts.seedStablePages ?? false,
    credentials: opts.credentials ?? {},
  };
}
