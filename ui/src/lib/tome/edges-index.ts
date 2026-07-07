/**
 * Backlink index for edges.
 *
 * An edge is authored as a page in its SOURCE project's `edges/` dir (design
 * decision A) — there is no copy of the file in the target project.
 * This index is the mechanism that lets the target side see it anyway: every
 * write to an `edges/*.md` path is mirrored into `tome_edges_index`, keyed by
 * the edge's *resolved* target project, so `incomingEdgesFor(targetSlug)` can
 * answer "what points at me" with a single query instead of scanning every
 * other project's pages.
 *
 * Kept updated from the single PageStore choke point (see `getPageStore` in
 * `./page-store.ts`), so it stays in sync regardless of who writes the edge
 * (a human via the wiki UI, the ingest agent, or chat) and regardless of the
 * active PageStore backend.
 */

import { getTomeEdgesIndexCollection } from "./mongo-collections";
import {
  EDGES_DIR,
  EDGE_TYPE,
  FM_CONFIDENCE,
  FM_RELATION,
  FM_SOURCE,
  FM_STATUS,
  FM_TARGET,
  FM_TYPE,
  parseFrontmatter,
} from "./schema";
import { parseTomeHref } from "./tome-links";
import type { EdgeIndexRow } from "@/types/tome";

function rowId(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}

/** Re-derive the index row for one `edges/<slug>.md` write (or remove it if
 * the page was deleted or retyped away from `type: edge`). No-op for any path
 * outside `edges/`. */
export async function syncEdgeIndex(
  sourceProjectId: string,
  sourceProjectSlug: string,
  path: string,
  markdown: string | null,
): Promise<void> {
  if (!path.startsWith(`${EDGES_DIR}/`)) return;
  const col = await getTomeEdgesIndexCollection();
  const _id = rowId(sourceProjectId, path);

  if (markdown === null) {
    await col.deleteOne({ _id });
    return;
  }

  const [fm] = parseFrontmatter(markdown);
  if (String(fm[FM_TYPE] ?? "").toLowerCase() !== EDGE_TYPE) {
    await col.deleteOne({ _id });
    return;
  }

  const target = String(fm[FM_TARGET] ?? "").trim();
  const targetHref = target ? parseTomeHref(target) : null;
  const targetProjectSlug = targetHref?.project ?? sourceProjectSlug;

  const row: EdgeIndexRow = {
    _id,
    source_project_id: sourceProjectId,
    source_project_slug: sourceProjectSlug,
    path,
    relation: String(fm[FM_RELATION] ?? "").trim(),
    source: String(fm[FM_SOURCE] ?? "").trim(),
    target,
    target_project_slug: targetProjectSlug,
    confidence: String(fm[FM_CONFIDENCE] ?? "").trim() || undefined,
    status: String(fm[FM_STATUS] ?? "active").trim() || "active",
    updated_at: new Date(),
  };
  await col.replaceOne({ _id }, row, { upsert: true });
}

/**
 * Edges targeting `projectSlug`, authored from any OTHER project. Same-project
 * edges aren't included — they're already visible in the project's own
 * `edges/` tree.
 */
export async function incomingEdgesFor(projectSlug: string): Promise<EdgeIndexRow[]> {
  const col = await getTomeEdgesIndexCollection();
  return col
    .find({
      target_project_slug: projectSlug,
      source_project_slug: { $ne: projectSlug },
    })
    .sort({ updated_at: -1 })
    .toArray();
}
