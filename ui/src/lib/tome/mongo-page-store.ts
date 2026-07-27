/**
 * PageStore backend: page bodies inlined in Mongo.
 *
 * Append-only `tome_page_revisions`: each write inserts a row; the current
 * live body for a path is the latest non-tombstone, non-draft revision by
 * (created_at, _id). The agent's `/project` working copy is rehydrated from
 * this store over the tome API rather than mirrored on disk.
 */

import { ObjectId, type Filter } from "mongodb";

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
      ...(opts.status === "draft" ? { status: "draft" as const } : {}),
    }));
    const col = await getTomePageRevisionsCollection();
    await col.insertMany(rows);
  }

  async readPage(
    projectId: string,
    path: string,
    opts: { includeDrafts?: boolean } = {},
  ): Promise<string> {
    const safe = safePagePath(path);
    const col = await getTomePageRevisionsCollection();
    const excluded = opts.includeDrafts ? ["rejected" as const] : ["draft" as const, "rejected" as const];
    const filter: Filter<PageRevision> = {
      project_id: projectId,
      path: safe,
      status: { $nin: excluded },
    };
    const rev = await col.findOne(filter, { sort: { created_at: -1, _id: -1 } });
    if (!rev || rev.deleted) {
      throw new PageNotFoundError(path);
    }
    return rev.markdown ?? "";
  }

  async listPages(
    projectId: string,
    opts: { includeDrafts?: boolean } = {},
  ): Promise<Record<string, string>> {
    const col = await getTomePageRevisionsCollection();
    const excluded = opts.includeDrafts ? ["rejected" as const] : ["draft" as const, "rejected" as const];
    const filter: Filter<PageRevision> = { project_id: projectId, status: { $nin: excluded } };
    // Newest-first; first row seen per path wins (tombstone or body).
    const rows = await col
      .find(filter)
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

  async readRevision(
    projectId: string,
    revisionId: string,
  ): Promise<PageRevision | null> {
    const col = await getTomePageRevisionsCollection();
    // Revisions are stored with auto ObjectId ids; accept the hex string.
    const idFilter = ObjectId.isValid(revisionId)
      ? (new ObjectId(revisionId) as unknown as string)
      : revisionId;
    return col.findOne({ _id: idFilter, project_id: projectId });
  }

  async promoteDraftReport(projectId: string, reportId: string): Promise<void> {
    const col = await getTomePageRevisionsCollection();
    await col.updateMany(
      { project_id: projectId, report_id: reportId, status: "draft" },
      { $unset: { status: "" } },
    );
  }

  async rejectDraftReport(projectId: string, reportId: string): Promise<void> {
    const col = await getTomePageRevisionsCollection();
    // Draft rows are already excluded from live reads. Re-stamp them
    // "rejected" (rather than deleting) so they stop showing as pending
    // review while staying in history; the prior live revision (if any)
    // is unaffected and remains current.
    await col.updateMany(
      { project_id: projectId, report_id: reportId, status: "draft" },
      { $set: { status: "rejected" } },
    );
  }

  async listDraftPaths(projectId: string, reportId: string): Promise<string[]> {
    const col = await getTomePageRevisionsCollection();
    const rows = await col
      .find(
        { project_id: projectId, report_id: reportId, status: "draft" },
        { projection: { path: 1 } },
      )
      .toArray();
    return [...new Set(rows.map((r) => r.path))];
  }
}

/** Thrown by readPage when a path is missing or tombstoned. */
export class PageNotFoundError extends Error {
  constructor(path: string) {
    super(`page not found: ${path}`);
    this.name = "PageNotFoundError";
  }
}
