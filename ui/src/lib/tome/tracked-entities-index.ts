/**
 * Roll-up index for Issues, Decisions, and Suggestions.
 *
 * Entity bodies remain ordinary versioned wiki pages. This denormalized row
 * makes the critical-items report cheap and lets a target project surface an
 * item authored elsewhere through its explicit `tome://@project/...` target.
 */

import { getTomeTrackedEntitiesIndexCollection } from "./mongo-collections";
import {
  DECISION_TYPE,
  FM_CLOSED,
  FM_OPENED,
  FM_OWNER,
  FM_PRIORITY,
  FM_STATUS,
  FM_TARGET,
  FM_TITLE,
  FM_TYPE,
  ISSUE_TYPE,
  SUGGESTION_TYPE,
  isTrackedEntity,
  parseFrontmatter,
} from "./schema";
import { parseTomeHref } from "./tome-links";
import type { TrackedEntityIndexRow } from "@/types/tome";

const TRACKED_DIRS = ["issues/", "decisions/", "suggestions/"] as const;

export function isTrackedEntityPath(path: string): boolean {
  return TRACKED_DIRS.some((prefix) => path.startsWith(prefix));
}

function rowId(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}

export async function syncTrackedEntityIndex(
  sourceProjectId: string,
  sourceProjectSlug: string,
  path: string,
  markdown: string | null,
): Promise<void> {
  if (!isTrackedEntityPath(path)) return;
  const collection = await getTomeTrackedEntitiesIndexCollection();
  const _id = rowId(sourceProjectId, path);
  if (markdown === null) {
    await collection.deleteOne({ _id });
    return;
  }

  const [frontmatter, body] = parseFrontmatter(markdown);
  if (!isTrackedEntity(frontmatter)) {
    await collection.deleteOne({ _id });
    return;
  }
  const entityType = String(frontmatter[FM_TYPE] ?? "").toLowerCase();
  if (
    entityType !== ISSUE_TYPE &&
    entityType !== DECISION_TYPE &&
    entityType !== SUGGESTION_TYPE
  ) {
    await collection.deleteOne({ _id });
    return;
  }
  const target = String(frontmatter[FM_TARGET] ?? "").trim();
  const targetProjectSlug = parseTomeHref(target)?.project ?? sourceProjectSlug;
  const row: TrackedEntityIndexRow = {
    _id,
    source_project_id: sourceProjectId,
    source_project_slug: sourceProjectSlug,
    path,
    entity_type: entityType,
    title: String(frontmatter[FM_TITLE] ?? path).trim() || path,
    status: String(frontmatter[FM_STATUS] ?? "").trim(),
    priority: String(frontmatter[FM_PRIORITY] ?? "medium").trim() || "medium",
    owner: String(frontmatter[FM_OWNER] ?? "").trim() || undefined,
    opened: String(frontmatter[FM_OPENED] ?? "").trim() || undefined,
    closed: String(frontmatter[FM_CLOSED] ?? "").trim() || undefined,
    target: target || undefined,
    target_project_slug: targetProjectSlug,
    body: body.trim().slice(0, 2_000),
    updated_at: new Date(),
  };
  await collection.replaceOne({ _id }, row, { upsert: true });
}

export async function trackedEntitiesForRollup(
  projectSlugs: string[],
): Promise<TrackedEntityIndexRow[]> {
  const collection = await getTomeTrackedEntitiesIndexCollection();
  return collection
    .find({
      $or: [
        { source_project_slug: { $in: projectSlugs } },
        { target_project_slug: { $in: projectSlugs } },
      ],
    })
    .sort({ priority: 1, updated_at: -1 })
    .toArray();
}
