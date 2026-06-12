/**
 * Phase-1 PageStore backend: page bodies inlined in Mongo.
 *
 * Append-only `tome_page_revisions`: each write inserts a row; the current
 * body for a path is the latest non-tombstone revision by (created_at, _id).
 * Port of repo.py's sqlite store, minus the filesystem mirror (the agent's
 * `/project` working copy is rehydrated from this store over the tome API —
 * see PORT_PLAN.md §G).
 */

import { getTomePageRevisionsCollection } from "./mongo-collections";
import { safePagePath, type PageStore, type WritePageOpts } from "./page-store";
import type { PageRevision } from "@/types/tome";

const DEFAULT_AUTHOR = "tome";

export class MongoPageStore implements PageStore {
  async writePage(
    projectId: string,
    path: string,
    markdown: string,
    opts: WritePageOpts,
  ): Promise<void> {
    await this.writePages(projectId, { [path]: markdown }, opts);
  }

  async writePages(
    projectId: string,
    pages: Record<string, string>,
    opts: WritePageOpts,
  ): Promise<void> {
    const entries = Object.entries(pages);
    if (entries.length === 0) return;
    const now = new Date();
    const rows: PageRevision[] = entries.map(([path, md]) => ({
      project_id: projectId,
      path: safePagePath(path),
      markdown: md,
      author: opts.author ?? DEFAULT_AUTHOR,
      message: opts.message,
      created_at: now,
      ...(opts.reportId ? { report_id: opts.reportId } : {}),
    }));
    const col = await getTomePageRevisionsCollection();
    await col.insertMany(rows);
  }

  async readPage(projectId: string, path: string): Promise<string> {
    const safe = safePagePath(path);
    const col = await getTomePageRevisionsCollection();
    const rev = await col.findOne(
      { project_id: projectId, path: safe },
      { sort: { created_at: -1, _id: -1 } },
    );
    if (!rev || rev.deleted) {
      throw new PageNotFoundError(path);
    }
    return rev.markdown ?? "";
  }

  async listPages(projectId: string): Promise<Record<string, string>> {
    const col = await getTomePageRevisionsCollection();
    // Newest-first; first row seen per path wins (tombstone or body).
    const rows = await col
      .find({ project_id: projectId })
      .sort({ path: 1, created_at: -1, _id: -1 })
      .toArray();
    const out: Record<string, string> = {};
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      if (!r.deleted) out[r.path] = r.markdown ?? "";
    }
    return out;
  }

  async deletePage(
    projectId: string,
    path: string,
    opts: { author?: string; message?: string } = {},
  ): Promise<void> {
    const safe = safePagePath(path);
    const col = await getTomePageRevisionsCollection();
    await col.insertOne({
      project_id: projectId,
      path: safe,
      markdown: "",
      author: opts.author ?? DEFAULT_AUTHOR,
      message: opts.message || `deleted ${safe}`,
      deleted: true,
      created_at: new Date(),
    });
  }

  async pageHistory(projectId: string, path: string): Promise<PageRevision[]> {
    const safe = safePagePath(path);
    const col = await getTomePageRevisionsCollection();
    return col
      .find({ project_id: projectId, path: safe })
      .sort({ created_at: -1, _id: -1 })
      .toArray();
  }
}

/** Thrown by readPage when a path is missing or tombstoned. */
export class PageNotFoundError extends Error {
  constructor(path: string) {
    super(`page not found: ${path}`);
    this.name = "PageNotFoundError";
  }
}
