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

import { resolveAreaChildren, resolveBhagChildren } from "./bhag";
import { listReadableTomeProjects } from "./access";
import { tomeSessionSubject } from "./data-steward";
import { getPageStore } from "./page-store";
import { stablePathsIn } from "./schema";
import type { TomeProjectContext } from "./tome-api";
import type { ProjectDocument } from "@/types/projects";
import { isSynthesizedType } from "@/types/projects";

/**
 * Wire shape for forwarded user credentials. The agent reads these off the
 * request and routes them to the right MCP per-call. Values are strings on
 * the wire (incl. `expires_in`); the agent parses defensively.
 */
export type ForwardedCredentials = Record<string, Record<string, string>>;

/** Providers we recognize as "tome connectors" — matches MCP slugs on the agent. */
type Provider = "github" | "atlassian" | "webex";

/** All providers the agent understands; the credential store returns nothing
 * for providers the user hasn't connected. */
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
  root_page_id?: string;
  root_page_title?: string;
  include_descendants?: boolean;
  page_scopes?: Array<{
    page_id: string;
    page_title: string;
    include_descendants: boolean;
  }>;
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
  project_type: "project" | "bhag" | "area";
  repos: RepoSnapshot[];
  webex_rooms: WebexRoomSnapshot[];
  confluence_spaces: ConfluenceSpaceSnapshot[];
  child_projects: ChildProjectSnapshot[];
  /** Per-request OpenFGA-filtered catalog available to cross-project tools. */
  readable_projects: ChildProjectSnapshot[];
}

/** ChatRequest — mirrors contract.ChatRequest. */
export interface AgentChatRequest {
  message: string;
  sdk_session_id: string | null;
  is_compact?: boolean;
  snapshot: ProjectSnapshot;
  stable_pages: Record<string, string>;
  role: "viewer" | "editor";
  /** The chatting user's email, so a `feed_promote` call attributes to them
   * instead of a generic "tome" handle. */
  actor_email: string | null;
  /** The chatting user's OIDC subject. Forwarded in write-page callbacks so
   * the internal API can enforce FGA can_write on chat-initiated edits. */
  actor_sub: string | null;
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
  const snapshot: ConfluenceSpaceSnapshot = {
    slug: s.slug,
    name: s.name,
    space_key: s.space_key,
    base_url: s.base_url ?? "",
  };
  const pageScopes = s.page_scopes?.length
    ? s.page_scopes
    : s.page_scope
      ? [s.page_scope]
      : [];
  if (pageScopes.length) {
    snapshot.page_scopes = pageScopes.map((scope) => ({
      page_id: scope.page_id,
      page_title: scope.page_title,
      include_descendants: scope.include_descendants,
    }));
    snapshot.root_page_id = pageScopes[0].page_id;
    snapshot.root_page_title = pageScopes[0].page_title;
    snapshot.include_descendants = pageScopes[0].include_descendants;
  }
  return snapshot;
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
function parseConfluenceSpaceUrl(
  url: string,
  pageScopes: NonNullable<ProjectDocument["sources"]>["confluence_page_scopes"] = [],
  legacyPageScope?: NonNullable<
    ProjectDocument["sources"]
  >["confluence_page_scope"],
): ConfluenceSpaceSnapshot | null {
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
  const pageIdFromUrl =
    trimmed.match(/\/wiki\/spaces\/[^/?#]+\/pages\/(\d+)(?:\/|$)/i)?.[1];
  const normalizedScopes = pageScopes.length
    ? pageScopes
    : legacyPageScope
      ? [legacyPageScope]
      : pageIdFromUrl
        ? [
            {
              page_id: pageIdFromUrl,
              page_title: "",
              space_key: key,
              include_descendants: true,
            },
          ]
        : [];
  const firstScope = normalizedScopes[0];
  return {
    slug: spaceSlug(key),
    name: key,
    space_key: key,
    base_url: baseUrl,
    ...(normalizedScopes.length
      ? {
          page_scopes: normalizedScopes.map((scope) => ({
            page_id: scope.page_id,
            page_title: scope.page_title,
            include_descendants: scope.include_descendants,
          })),
          root_page_id: firstScope.page_id,
          root_page_title: firstScope.page_title,
          include_descendants: firstScope.include_descendants,
        }
      : {}),
  };
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
  const fromUrl = parseConfluenceSpaceUrl(
    project.sources?.confluence_url ?? "",
    project.sources?.confluence_page_scopes,
    project.sources?.confluence_page_scope,
  );
  return fromUrl ? [fromUrl] : [];
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
    slug: project.slug,
    name: project.title || project.name,
    charter: project.description ?? "",
    phase: null,
    cadence: null,
    project_type: project.type ?? "project",
    repos: (project.sources?.repos ?? []).map(toRepoSnapshot),
    webex_rooms: projectWebexRooms(project),
    confluence_spaces: projectConfluenceSpaces(project),
    child_projects: [],
    readable_projects: [],
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
  opts: { message: string; sdkSessionId: string | null; isCompact?: boolean },
): Promise<AgentChatRequest> {
  const [stablePages, credentials] = await Promise.all([
    loadStablePages(ctx.projectId),
    resolveForwardedCredentials(ctx),
  ]);
  const snapshot = buildSnapshot(ctx);
  const readableProjects = await listReadableTomeProjects(
    tomeSessionSubject(ctx.session),
    { isAdmin: ctx.canManageSteward },
  );
  snapshot.readable_projects = readableProjects.map((project) => ({
    project_id: String(project._id),
    slug: project.slug,
    name: project.title || project.name,
  }));
  const readableSlugs = new Set(snapshot.readable_projects.map((project) => project.slug));
  // Synthesized types (BHAG/Area) also carry tagged child-project wikis so chat
  // can read across both those roll-up inputs and directly attached sources.
  if (isSynthesizedType(ctx.project.type)) {
    snapshot.child_projects = (
      ctx.project.type === "area"
        ? await resolveAreaChildren(ctx.project.name)
        : await resolveBhagChildren(ctx.project.name)
    ).filter((project) => readableSlugs.has(project.slug));
  }
  return {
    message: opts.message,
    sdk_session_id: opts.sdkSessionId,
    ...(opts.isCompact ? { is_compact: true } : {}),
    snapshot,
    stable_pages: stablePages,
    role: ctx.canEdit ? "editor" : "viewer",
    actor_email: ctx.user.email ?? null,
    actor_sub: tomeSessionSubject(ctx.session),
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
    /** BHAG/Area only: tagged child projects to synthesize with direct sources. */
    childProjects?: ChildProjectSnapshot[];
    /** OpenFGA-filtered cross-project catalog for agent read tools. */
    readableProjects?: ChildProjectSnapshot[];
  },
): AgentIngestRequest {
  const snapshot = buildSnapshotFromProject(project);
  if (opts.childProjects?.length) {
    snapshot.child_projects = opts.childProjects;
  }
  if (opts.readableProjects?.length) {
    snapshot.readable_projects = opts.readableProjects;
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
