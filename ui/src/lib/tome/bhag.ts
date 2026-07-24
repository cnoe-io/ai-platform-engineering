// BHAG and Area helpers shared across the ingest runner and the agent proxy
// (kept here to avoid a cycle between those two modules).

import { getCollection } from "@/lib/mongodb";
import { normLabel } from "@/lib/projects/labels";
import type { ProjectDocument } from "@/types/projects";

type ChildRef = { project_id: string; slug: string; name: string; type: "project" | "area" };

/**
 * Resolve the Areas tagged to a BHAG (their `labels.initiatives` contains
 * the BHAG's name). These are the first-tier children the BHAG synthesis reads.
 */
export async function resolveBhagAreas(bhagName: string): Promise<ChildRef[]> {
  const want = normLabel(bhagName);
  if (!want) return [];
  const col = await getCollection<ProjectDocument>("projects");
  const candidates = await col
    .find({ type: "area", "labels.initiatives": { $exists: true, $ne: [] } })
    .toArray();
  return candidates
    .filter((p) => (p.labels?.initiatives ?? []).some((i) => normLabel(i) === want))
    .map((p) => ({ project_id: String(p._id), slug: p.slug, name: p.title || p.name, type: "area" }));
}

/**
 * Resolve projects that tag a given Area (via `labels.areas`). These are the
 * leaf projects an Area synthesis reads.
 */
export async function resolveAreaChildren(areaName: string): Promise<ChildRef[]> {
  const want = normLabel(areaName);
  if (!want) return [];
  const col = await getCollection<ProjectDocument>("projects");
  const candidates = await col
    .find({
      $or: [{ type: "project" }, { type: { $exists: false } }],
      "labels.areas": { $exists: true, $ne: [] },
    })
    .toArray();
  return candidates
    .filter((p) => (p.labels?.areas ?? []).some((a) => normLabel(a) === want))
    .map((p) => ({ project_id: String(p._id), slug: p.slug, name: p.title || p.name, type: "project" }));
}

/**
 * Resolve all direct children of a BHAG for synthesis: Areas tagged to it,
 * PLUS skip-level projects that tag the BHAG directly via `labels.initiatives`
 * (without going through an Area). Each entry's `type` tells the caller which
 * kind it is — a cascade needs to recurse into an Area's own children before
 * ingesting/synthesizing it, but a skip-level project is a plain ingest leaf.
 */
export async function resolveBhagChildren(bhagName: string): Promise<ChildRef[]> {
  const want = normLabel(bhagName);
  if (!want) return [];
  const col = await getCollection<ProjectDocument>("projects");
  const candidates = await col
    .find({
      $or: [{ type: "project" }, { type: { $exists: false } }, { type: "area" }],
      "labels.initiatives": { $exists: true, $ne: [] },
    })
    .toArray();
  return candidates
    .filter((p) => (p.labels?.initiatives ?? []).some((i) => normLabel(i) === want))
    .map((p) => ({
      project_id: String(p._id),
      slug: p.slug,
      name: p.title || p.name,
      type: p.type === "area" ? "area" : "project",
    }));
}
