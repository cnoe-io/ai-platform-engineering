/**
 * Shared TypeScript types for Tome — the native caipe-ui wiki app
 * (port of tiny-teams-with-tokens).
 *
 *  - Tome does NOT own a project entity. It reuses CAIPE `ProjectDocument`
 *    (`@/types/projects`); every row here carries `project_id` (FK → CAIPE
 *    `projects._id`/`slug`).
 *  - Stay snake_case for stored fields to match existing CAIPE collections
 *    (see ui/src/lib/mongodb.ts and types/agentic-sdlc.ts).
 *  - Page *bodies* are addressed through the `PageStore` interface
 *    (`@/lib/tome/page-store`); Mongo holds the index/metadata only.
 */

// ---------------------------------------------------------------------------
// Collections (index/metadata only — NO `projects`; reuse CAIPE's)
// ---------------------------------------------------------------------------

export const TOME_COLLECTIONS = {
  /** One row per page write (append-only); current state = latest non-tombstone per (project_id, path). */
  PAGE_REVISIONS: "tome_page_revisions",
  /** Per-ingest report summary (a versioned snapshot of the wiki). */
  REPORTS: "tome_reports",
  /** Ingest run lifecycle + streamed log. */
  INGEST_RUNS: "tome_ingest_runs",
  /** Chat sessions (one per project+user thread). */
  CHAT_SESSIONS: "tome_chat_sessions",
  /** Chat messages within a session. */
  CHAT_MESSAGES: "tome_chat_messages",
  /** Backlink index over `edges/*.md` pages, keyed by resolved target project. */
  EDGES_INDEX: "tome_edges_index",
  /** Search/roll-up index over issue, decision, and suggestion pages. */
  TRACKED_ENTITIES_INDEX: "tome_tracked_entities_index",
  /** Gists — lightweight, non-wiki context chunks. */
  GISTS: "tome_gists",
} as const;

export type TomeCollectionName =
  (typeof TOME_COLLECTIONS)[keyof typeof TOME_COLLECTIONS];

// ---------------------------------------------------------------------------
// Page kind / node kind
// ---------------------------------------------------------------------------

/** Page kinds, as declared in each page's YAML frontmatter `kind` field. */
export type PageKind = "stable" | "dynamic" | "hidden" | "report";

export const PAGE_KINDS: readonly PageKind[] = [
  "stable",
  "dynamic",
  "hidden",
  "report",
];

/**
 * Sidebar node kind. Superset of PageKind with a synthetic `folder` marker
 * for non-clickable directory headers (a nested page with no real `<dir>.md`).
 */
export type NodeKind = PageKind | "folder";

// ---------------------------------------------------------------------------
// Domain entities (stored in Mongo)
// ---------------------------------------------------------------------------

/**
 * A single immutable page write. The store is append-only: the "current"
 * body for a path is the latest non-tombstone revision by (created_at, _id).
 * Large bodies may live outside Mongo (object storage) — see PageStore; for
 * the Phase-1 `mongo` backend `markdown` is inlined here.
 */
export interface PageRevision {
  _id?: string;
  project_id: string; // FK → CAIPE projects._id / slug
  path: string; // e.g. "charter.md", "repos/mycelium/overview.md"
  /** Inlined body for the `mongo` PageStore; omitted when bodies live in object storage. */
  markdown?: string;
  /** Object-storage key when the body is externalized: `tome/{project_id}/{path}@{rev}.md`. */
  body_ref?: string;
  author: string;
  message: string;
  /** Tombstone — a deletion marker. Latest-tombstone hides the path from reads. */
  deleted?: boolean;
  /** The ingest run/report that produced this write, when agent-authored. */
  report_id?: string;
  /**
   * "draft" revisions are written by an ingest run awaiting human review —
   * excluded from normal reads/history until promoted to "live" (or
   * tombstoned on reject). Absent/undefined is treated as "live" for
   * revisions written before this field existed.
   */
  status?: "live" | "draft" | "rejected";
  /** Set when this write restored a prior revision's body — the _id of that revision. */
  reverted_from?: string;
  created_at: Date;
}

/**
 * One indexed row per `edges/<slug>.md` page, rebuilt on every write to
 * that path and removed on delete/retype. Lets the TARGET project surface an
 * edge authored in some other (SOURCE) project's `edges/` dir, without either
 * side owning a copy of the file.
 */
export interface EdgeIndexRow {
  _id?: string; // `${source_project_id}:${path}`
  source_project_id: string;
  source_project_slug: string;
  path: string; // e.g. "edges/x-pivot-blocks-y-q3.md"
  relation: string;
  source: string; // authored `source` ref (tome://…)
  target: string; // authored `target` ref (tome://…)
  target_project_slug: string; // resolved from `target`; same as source slug if same-project
  confidence?: string;
  status: string;
  updated_at: Date;
}

/** Denormalized index row for one tracked-entity page. */
export interface TrackedEntityIndexRow {
  _id?: string; // `${source_project_id}:${path}`
  source_project_id: string;
  source_project_slug: string;
  path: string;
  entity_type: "issue" | "decision" | "suggestion";
  title: string;
  status: string;
  priority: string;
  owner?: string;
  opened?: string;
  closed?: string;
  target?: string;
  target_project_slug: string;
  body: string;
  updated_at: Date;
}

/** A versioned wiki snapshot produced by one ingest run. */
export interface Report {
  _id?: string;
  project_id: string;
  version: number;
  summary?: string;
  created_at: Date;
}

export type IngestRunStatus =
  | "queued"
  | "running"
  | "awaiting_review"
  | "succeeded"
  | "failed";

/** What the queue worker needs to actually start a queued run later. */
export interface IngestDispatch {
  /** Agent endpoint: "/ingest" (source pull) or "/synthesize" (BHAG roll-up). */
  endpoint: string;
  seed?: string | null;
  /** "quick" skips the breadth-first source sweep. Default "full". */
  mode?: "full" | "quick";
  seedStablePages?: boolean;
  webexMeetings?: { id: string; title: string; start: string }[];
  /**
   * Bypass draft review: promote this run's pages straight to "live" on
   * completion, same as before the draft-review feature existed.
   */
  skipReview?: boolean;
}

/** Lifecycle + streamed log for one ingest run. */
export interface IngestRun {
  _id?: string;
  project_id: string;
  report_id?: string;
  status: IngestRunStatus;
  /** Whether this was the greenfield (first) ingest that seeds stable pages. */
  greenfield: boolean;
  log: string[];
  error?: string;
  started_at: Date;
  finished_at?: Date;
  /** Groups the runs of one cascade level (N child re-ingests + the parent
   * synthesize at that level). A three-tier BHAG cascade nests one of these
   * per Area, plus one for the BHAG's own skip-level children. */
  cascade_id?: string;
  cascade_role?: "child" | "parent";
  /** Additional cascade_ids (whole sub-cascades, not just direct children)
   * this run must wait on before starting — e.g. a BHAG's synthesize run
   * blocks on each of its Areas' own (leaf-ingest + synthesize) sub-cascades,
   * in addition to its own direct cascade_id/cascade_role wait. */
  blocked_by_cascade_ids?: string[];
  /** OIDC sub of the triggering user; the worker re-resolves their forwarded
   *  OAuth credentials at dispatch time (the request session is long gone). */
  triggered_by_sub?: string;
  /** Params the worker uses to start a queued run; absent on the immediate path. */
  dispatch?: IngestDispatch;
  /** When the run was enqueued (queued runs); start time is `started_at`. */
  queued_at?: Date;
  /** Whether this run's pages went straight to "live" without draft review. */
  skip_review?: boolean;
  /**
   * Deadline for auto-promotion while `status === "awaiting_review"`. Set
   * when the run enters review; a reaper (`promoteOverdueRuns`) promotes any
   * run still awaiting review past this time.
   */
  review_deadline?: Date;
  /** How the run left `awaiting_review`, for the Feed/audit trail. */
  review_outcome?: "approved" | "rejected" | "auto_promoted";
  /** Who resolved the review — email of the approving/rejecting user. Absent
   * when `review_outcome === "auto_promoted"` (no reviewer showed up). */
  reviewed_by?: string;
  reviewed_at?: Date;
  /** Latest cumulative token usage, updated live during the run for the header. */
  usage?: { output: number; input: number };
  /** Agent-reported final cost in USD. Absent for legacy runs and providers
   * that do not report a cost; absence is deliberately not treated as $0. */
  cost_usd?: number;
  /** Agent-reported number of turns completed by the run. */
  turns?: number;
  /**
   * Latest exact context-window occupancy, from the Claude Agent SDK's own
   * live accounting (the same figure the CLI's `/context` shows) — accounts
   * for system prompt, tool defs, memory files, and the real model max /
   * autocompact threshold. Updated live during the run for the header.
   */
  context_usage?: {
    percentage: number;
    total_tokens: number;
    max_tokens: number;
    model: string;
  };
}

/** One in-flight run, as surfaced on the projects hub (GET /api/projects). */
export interface ActiveIngestRun {
  status: "queued" | "running";
  mode: "ingest" | "bhag_rollup";
  started_at: Date | null;
  queued_at: Date | null;
  project_slug: string;
  project_title: string;
}

export interface ChatSession {
  _id?: string;
  project_id: string;
  user_id: string;
  title?: string;
  /** Claude Agent SDK session id — a resume hint, not the durable key. */
  sdk_session_id?: string;
  created_at: Date;
  updated_at: Date;
}

export type ChatRole = "user" | "assistant" | "system";

/**
 * One segment of an assistant turn, in stream-arrival order — text and tool
 * chips interleaved (mirrors ChatPanel's render model so reload is faithful).
 */
export type ChatPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; label: string; path?: string };

export interface ChatMessage {
  _id?: string;
  session_id: string;
  project_id: string;
  role: ChatRole;
  /** Plain-text transcript (concatenated text parts) — always set. */
  content: string;
  /** Interleaved render model; absent on legacy/user rows (fall back to content). */
  parts?: ChatPart[];
  created_at: Date;
}

/**
 * A gist: a quick, non-committal chunk of context (a prompt, an agent memory,
 * a snippet) that's saved and shareable without becoming part of the curated
 * wiki. NOT ingested, NOT synthesized, NOT loaded into agent context by
 * default — a stored, linkable chunk a teammate pulls in only when relevant.
 */
export interface Gist {
  _id?: string;
  project_id: string;
  title: string;
  /** Markdown body. */
  body: string;
  author: string; // email of the creator
  created_at: Date;
  /** Freeform labels for lightweight filtering — no hierarchy, unlike wiki paths. */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// API DTOs (camelCase at the wire boundary for the browser)
// ---------------------------------------------------------------------------

/** A node in the sidebar page tree (see lib/tome/schema.ts buildTree). */
export interface PageTreeNode {
  path: string;
  title: string;
  kind: NodeKind;
  order: number;
  children: PageTreeNode[];
}

/** GET …/pages/[...path] response. */
export interface PageResponse {
  path: string;
  markdown: string;
  title: string;
  kind: PageKind;
}
