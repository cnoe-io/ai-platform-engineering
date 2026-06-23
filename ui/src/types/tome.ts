/**
 * Shared TypeScript types for Tome — the native caipe-ui wiki app
 * (port of tiny-teams-with-tokens).
 *
 * Design notes (see ui/src/app/(app)/apps/tome/PORT_PLAN.md):
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
} as const;

export type TomeCollectionName =
  (typeof TOME_COLLECTIONS)[keyof typeof TOME_COLLECTIONS];

// ---------------------------------------------------------------------------
// Page kind / node kind (port of reports/schema.py)
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
  created_at: Date;
}

/** A versioned wiki snapshot produced by one ingest run. */
export interface Report {
  _id?: string;
  project_id: string;
  version: number;
  summary?: string;
  created_at: Date;
}

export type IngestRunStatus = "queued" | "running" | "succeeded" | "failed";

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
