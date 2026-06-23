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
 */
export async function getPageStore(): Promise<PageStore> {
  if (cached) return cached;
  const backend = process.env.TOME_PAGE_STORE || "mongo";
  switch (backend) {
    case "mongo": {
      const { MongoPageStore } = await import("./mongo-page-store");
      cached = new MongoPageStore();
      return cached;
    }
    // case "s3": ... (added with the object-storage value-add)
    default:
      throw new Error(`unknown TOME_PAGE_STORE backend: ${backend}`);
  }
}
