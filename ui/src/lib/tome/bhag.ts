// BHAG helpers shared across the ingest runner and the agent proxy (kept here
// to avoid a cycle between those two modules).

import { getCollection } from "@/lib/mongodb";
import { normLabel } from "@/lib/projects/labels";
import type { ProjectDocument } from "@/types/projects";

/**
 * Resolve the projects tagged to a BHAG (its `labels.initiatives` contains the
 * BHAG's name, case-insensitively). These are the wikis the BHAG synthesis reads
 * and that BHAG chat can read across. Excludes BHAGs themselves.
 */
export async function resolveBhagChildren(
  bhagName: string,
): Promise<{ project_id: string; slug: string; name: string }[]> {
  const want = normLabel(bhagName);
  if (!want) return [];
  const projects = await getCollection<ProjectDocument>("projects");
  const candidates = await projects
    .find({
      $or: [{ type: "project" }, { type: { $exists: false } }],
      "labels.initiatives": { $exists: true, $ne: [] },
    })
    .toArray();
  return candidates
    .filter((p) => (p.labels?.initiatives ?? []).some((i) => normLabel(i) === want))
    .map((p) => ({ project_id: String(p._id), slug: p.slug, name: p.title || p.name }));
}
