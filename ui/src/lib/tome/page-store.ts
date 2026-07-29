/**
 * PageStore — the swappable backend for wiki page *bodies*.
 *
 *   - `mongo` (this repo's default): bodies inlined in Mongo
 *     `tome_page_revisions` rows. Zero new infra; fine for small wikis.
 *   - `s3` (later): bodies in object storage (MinIO → S3), Mongo holds only
 *     the revision index, browser fetches via presigned URLs.
 *
 * Selected via `TOME_PAGE_STORE=mongo|s3`. The agent's `write_page` HTTP
 * callback targets the tome API, which writes through the active store — so
 * the agent stays storage-agnostic.
 *
 * Server-only.
 */

import type { PageRevision } from "@/types/tome";

export interface WritePageOpts {
  message: string;
  author?: string;
  reportId?: string;
  /** "draft" holds this write pending review; omitted/undefined = "live". */
  status?: "live" | "draft";
}

/** Backend-agnostic contract for reading/writing wiki page bodies. */
export interface PageStore {
  /** Write one page (append a new revision). */
  writePage(
    projectId: string,
    path: string,
    markdown: string,
    opts: WritePageOpts,
  ): Promise<void>;

  /** Write many pages atomically-ish under one message/timestamp. */
  writePages(
    projectId: string,
    pages: Record<string, string>,
    opts: WritePageOpts,
  ): Promise<void>;

  /** Latest live body for a path. Throws if missing, tombstoned, or only a draft exists. */
  readPage(
    projectId: string,
    path: string,
    opts?: { includeDrafts?: boolean },
  ): Promise<string>;

  /** Current live state: `{path: markdown}`, tombstones and drafts excluded. */
  listPages(
    projectId: string,
    opts?: { includeDrafts?: boolean },
  ): Promise<Record<string, string>>;

  /** Tombstone a page (append a deleted revision). Idempotent. */
  deletePage(
    projectId: string,
    path: string,
    opts?: { author?: string; message?: string },
  ): Promise<void>;

  /** All revisions of a page, newest first. */
  pageHistory(projectId: string, path: string): Promise<PageRevision[]>;

  /** A single revision by id (with its body), or null if not found. */
  readRevision(
    projectId: string,
    revisionId: string,
  ): Promise<PageRevision | null>;

  /**
   * Flip every draft revision for a report to "live" (approve). In-place
   * status update — cheap, preserves the append-only history as-is.
   */
  promoteDraftReport(projectId: string, reportId: string): Promise<void>;

  /**
   * Tombstone every draft revision for a report (reject) — the prior live
   * revision (if any) remains current.
   */
  rejectDraftReport(projectId: string, reportId: string): Promise<void>;

  /** Paths with a pending (unreviewed) draft revision for a report. */
  listDraftPaths(projectId: string, reportId: string): Promise<string[]>;

  /** Paths touched by any run's report — draft, rejected, or already-live. */
  listTouchedPaths(projectId: string, reportId: string): Promise<string[]>;

  /**
   * Restore a prior revision's body as a new write (append-only — the
   * reverted-from revision stays in history). Throws if the revision isn't
   * found.
   */
  revertPage(
    projectId: string,
    path: string,
    revisionId: string,
    opts: { author?: string; message?: string },
  ): Promise<void>;

  /**
   * Presigned read URL for large bodies (s3 backend). Returns null for
   * backends that inline bodies (mongo) — caller falls back to readPage.
   */
  presignRead?(projectId: string, path: string): Promise<string | null>;
}

/**
 * Reject path traversal; require a `.md` suffix; normalize separators.
 * Port of repo.py `_safe_page_path`.
 */
export function safePagePath(pagePath: string): string {
  if (!pagePath || pagePath.startsWith("/") || pagePath.endsWith("/")) {
    throw new Error(`invalid page path: ${JSON.stringify(pagePath)}`);
  }
  const parts = pagePath.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new Error(`invalid page path component: ${JSON.stringify(pagePath)}`);
  }
  if (!pagePath.endsWith(".md")) {
    throw new Error(`page path must end with .md: ${JSON.stringify(pagePath)}`);
  }
  return pagePath;
}

let cached: PageStore | null = null;

/**
 * Resolve the configured PageStore singleton. Phase 1 only wires the `mongo`
 * backend; `s3` is added later behind the same interface.
 *
 * Wrapped in `withStructuredIndexes` so cross-project edges and tracked
 * entities stay queryable from this one choke point, regardless of caller.
 */
export async function getPageStore(): Promise<PageStore> {
  if (cached) return cached;
  const backend = process.env.TOME_PAGE_STORE || "mongo";
  switch (backend) {
    case "mongo": {
      const { MongoPageStore } = await import("./mongo-page-store");
      cached = withStructuredIndexes(new MongoPageStore());
      return cached;
    }
    // case "s3": ... (added with the object-storage value-add)
    default:
      throw new Error(`unknown TOME_PAGE_STORE backend: ${backend}`);
  }
}

/**
 * Decorate a PageStore's write paths to keep structured indexes current.
 * Explicit passthrough (not `{...store}`) — the underlying store's methods
 * live on its class prototype, not as own properties, so a spread would drop
 * them all.
 */
function withStructuredIndexes(store: PageStore): PageStore {
  return {
    writePage: async (projectId, path, markdown, opts) => {
      await store.writePage(projectId, path, markdown, opts);
      if (opts.status !== "draft") {
        await reindexTouched(projectId, { [path]: markdown });
      }
    },
    writePages: async (projectId, pages, opts) => {
      await store.writePages(projectId, pages, opts);
      if (opts.status !== "draft") {
        await reindexTouched(projectId, pages);
      }
    },
    deletePage: async (projectId, path, opts) => {
      await store.deletePage(projectId, path, opts);
      const slug = await projectSlugFor(projectId);
      if (slug) await removeFromIndexes(projectId, slug, path);
    },
    readPage: (projectId, path, opts) => store.readPage(projectId, path, opts),
    listPages: (projectId, opts) => store.listPages(projectId, opts),
    pageHistory: (projectId, path) => store.pageHistory(projectId, path),
    readRevision: (projectId, revisionId) => store.readRevision(projectId, revisionId),
    promoteDraftReport: async (projectId, reportId) => {
      const paths = await store.listDraftPaths(projectId, reportId);
      await store.promoteDraftReport(projectId, reportId);
      // Re-read each promoted path's live body before refreshing indexes.
      if (paths.length === 0) return;
      const live = await store.listPages(projectId);
      const touched: Record<string, string> = {};
      for (const p of paths) {
        if ((p.startsWith("edges/") || isTrackedPath(p)) && p in live) touched[p] = live[p];
      }
      await reindexTouched(projectId, touched);
    },
    rejectDraftReport: (projectId, reportId) => store.rejectDraftReport(projectId, reportId),
    listDraftPaths: (projectId, reportId) => store.listDraftPaths(projectId, reportId),
    listTouchedPaths: (projectId, reportId) => store.listTouchedPaths(projectId, reportId),
    revertPage: async (projectId, path, revisionId, opts) => {
      await store.revertPage(projectId, path, revisionId, opts);
      if (path.startsWith("edges/") || isTrackedPath(path)) {
        const live = await store.listPages(projectId);
        if (path in live) await reindexTouched(projectId, { [path]: live[path] });
      }
    },
    ...(store.presignRead
      ? { presignRead: (projectId: string, path: string) => store.presignRead!(projectId, path) }
      : {}),
  };
}

async function reindexTouched(
  projectId: string,
  pages: Record<string, string>,
): Promise<void> {
  const touched = Object.keys(pages).filter(
    (path) => path.startsWith("edges/") || isTrackedPath(path),
  );
  if (touched.length === 0) return;
  const slug = await projectSlugFor(projectId);
  if (!slug) return;
  for (const path of touched) {
    await syncIndexes(projectId, slug, path, pages[path]);
  }
}

function isTrackedPath(path: string): boolean {
  return (
    path.startsWith("issues/") ||
    path.startsWith("decisions/") ||
    path.startsWith("suggestions/")
  );
}

async function syncIndexes(
  projectId: string,
  projectSlug: string,
  path: string,
  markdown: string,
): Promise<void> {
  if (path.startsWith("edges/")) {
    const { syncEdgeIndex } = await import("./edges-index");
    await syncEdgeIndex(projectId, projectSlug, path, markdown);
  }
  if (isTrackedPath(path)) {
    const { syncTrackedEntityIndex } = await import("./tracked-entities-index");
    await syncTrackedEntityIndex(projectId, projectSlug, path, markdown);
  }
}

async function removeFromIndexes(
  projectId: string,
  projectSlug: string,
  path: string,
): Promise<void> {
  if (path.startsWith("edges/")) {
    const { syncEdgeIndex } = await import("./edges-index");
    await syncEdgeIndex(projectId, projectSlug, path, null);
  }
  if (isTrackedPath(path)) {
    const { syncTrackedEntityIndex } = await import("./tracked-entities-index");
    await syncTrackedEntityIndex(projectId, projectSlug, path, null);
  }
}

async function projectSlugFor(projectId: string): Promise<string | null> {
  const { ObjectId } = await import("mongodb");
  const { getCollection } = await import("@/lib/mongodb");
  const projects = await getCollection<{ _id: unknown; slug: string }>("projects");
  if (!ObjectId.isValid(projectId)) return null;
  const p = await projects.findOne({ _id: new ObjectId(projectId) as never });
  return p?.slug ?? null;
}
