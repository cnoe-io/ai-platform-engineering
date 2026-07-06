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

  /** Latest body for a path. Throws if missing or tombstoned. */
  readPage(projectId: string, path: string): Promise<string>;

  /** Current state: `{path: markdown}`, tombstones excluded. */
  listPages(projectId: string): Promise<Record<string, string>>;

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
 * Wrapped in `withEdgesIndex` so the edges backlink index stays in sync
 * from this one choke point, regardless of backend or caller (UI save, ingest
 * agent write, chat agent write all funnel through here).
 */
export async function getPageStore(): Promise<PageStore> {
  if (cached) return cached;
  const backend = process.env.TOME_PAGE_STORE || "mongo";
  switch (backend) {
    case "mongo": {
      const { MongoPageStore } = await import("./mongo-page-store");
      cached = withEdgesIndex(new MongoPageStore());
      return cached;
    }
    // case "s3": ... (added with the object-storage value-add)
    default:
      throw new Error(`unknown TOME_PAGE_STORE backend: ${backend}`);
  }
}

/**
 * Decorate a PageStore's write paths to keep `tome_edges_index` current.
 * Explicit passthrough (not `{...store}`) — the underlying store's methods
 * live on its class prototype, not as own properties, so a spread would drop
 * them all.
 */
function withEdgesIndex(store: PageStore): PageStore {
  return {
    writePage: async (projectId, path, markdown, opts) => {
      await store.writePage(projectId, path, markdown, opts);
      await reindexTouched(projectId, { [path]: markdown });
    },
    writePages: async (projectId, pages, opts) => {
      await store.writePages(projectId, pages, opts);
      await reindexTouched(projectId, pages);
    },
    deletePage: async (projectId, path, opts) => {
      await store.deletePage(projectId, path, opts);
      const { syncEdgeIndex } = await import("./edges-index");
      const slug = await projectSlugFor(projectId);
      if (slug) await syncEdgeIndex(projectId, slug, path, null);
    },
    readPage: (projectId, path) => store.readPage(projectId, path),
    listPages: (projectId) => store.listPages(projectId),
    pageHistory: (projectId, path) => store.pageHistory(projectId, path),
    readRevision: (projectId, revisionId) => store.readRevision(projectId, revisionId),
    ...(store.presignRead
      ? { presignRead: (projectId: string, path: string) => store.presignRead!(projectId, path) }
      : {}),
  };
}

async function reindexTouched(
  projectId: string,
  pages: Record<string, string>,
): Promise<void> {
  const touched = Object.keys(pages).filter((p) => p.startsWith("edges/"));
  if (touched.length === 0) return;
  const { syncEdgeIndex } = await import("./edges-index");
  const slug = await projectSlugFor(projectId);
  if (!slug) return;
  for (const path of touched) {
    await syncEdgeIndex(projectId, slug, path, pages[path]);
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
