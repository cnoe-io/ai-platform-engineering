import { getCollection } from "@/lib/mongodb";
import type { MigrationApplyResult, MigrationPlanResult, MigrationSampleDiff } from "./types";

/**
 * Rewrite `labels.initiatives` and `labels.areas` on project documents from
 * display-name strings to the stable slug of the referenced BHAG or Area, and
 * unset the legacy `name` field that was frozen at creation time.
 *
 * BACKGROUND. Until this migration, child projects stored the display name of
 * their parent BHAG/Area in `labels.initiatives` / `labels.areas`
 * (e.g. `["IoC Governance"]`). Those strings were frozen at tag time — renaming
 * the BHAG/Area updated its `title` but left every child's label pointing at the
 * old name, breaking all child-resolution paths. The same dual-field problem
 * (`name` = frozen creation-time string, `title` = editable display name) caused
 * `name ?? title` / `title ?? name` fallbacks to scatter across the codebase.
 *
 * WHAT THIS DOES.
 *   1. For each BHAG and Area: build a map of normLabel(title | name) → slug.
 *   2. For each project: if any `labels.initiatives` or `labels.areas` value
 *      looks like a display name (contains a space or mixed case), replace it
 *      with the matching parent's slug. Values that are already lowercase with
 *      no spaces are treated as slugs and left unchanged.
 *   3. `$unset` the legacy `name` field from every project document that still
 *      carries it.
 *
 * Idempotent: a re-run finds labels already containing slugs and leaves them
 * unchanged; projects with no `name` field are untouched by the unset step.
 */

export const PROJECT_LABELS_TO_SLUG_MIGRATION_ID = "project_labels_to_slug_v1";
export const PROJECT_LABELS_TO_SLUG_CONFIRMATION = "MIGRATE project labels to slug";

function normLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function looksLikeSlug(value: string): boolean {
  return value === value.toLowerCase() && !value.includes(" ");
}

interface ProjectDoc {
  _id: unknown;
  slug: string;
  name?: string;
  title?: string;
  type?: string;
  labels?: { initiatives?: string[]; areas?: string[] };
}

export interface ProjectLabelsToSlugPlan {
  labelUpdates: Array<{
    id: unknown;
    slug: string;
    initiatives: string[];
    areas: string[];
    newInitiatives: string[];
    newAreas: string[];
  }>;
  nameUnsets: unknown[];
  unmapped: string[];
  warnings: string[];
}

export function computeProjectLabelsToSlugPlan(
  parents: ProjectDoc[],
  projects: ProjectDoc[],
): ProjectLabelsToSlugPlan {
  const nameToSlug = new Map<string, string>();
  for (const p of parents) {
    const display = p.title || p.name || "";
    if (display) nameToSlug.set(normLabel(display), p.slug);
    if (p.name && p.name !== display) nameToSlug.set(normLabel(p.name), p.slug);
  }

  const labelUpdates: ProjectLabelsToSlugPlan["labelUpdates"] = [];
  const nameUnsets: unknown[] = [];
  const unmapped: string[] = [];
  const warnings: string[] = [];

  for (const project of projects) {
    const initiatives = project.labels?.initiatives ?? [];
    const areas = project.labels?.areas ?? [];

    const newInitiatives = initiatives.map((i) => {
      if (looksLikeSlug(i)) return i;
      const slug = nameToSlug.get(normLabel(i));
      if (!slug) {
        unmapped.push(`${project.slug}: initiative "${i}"`);
        warnings.push(`No BHAG/Area found for initiative label "${i}" on project "${project.slug}"`);
        return i;
      }
      return slug;
    });

    const newAreas = areas.map((a) => {
      if (looksLikeSlug(a)) return a;
      const slug = nameToSlug.get(normLabel(a));
      if (!slug) {
        unmapped.push(`${project.slug}: area "${a}"`);
        warnings.push(`No Area found for area label "${a}" on project "${project.slug}"`);
        return a;
      }
      return slug;
    });

    const labelsChanged =
      JSON.stringify(newInitiatives) !== JSON.stringify(initiatives) ||
      JSON.stringify(newAreas) !== JSON.stringify(areas);

    if (labelsChanged) {
      labelUpdates.push({
        id: project._id,
        slug: project.slug,
        initiatives,
        areas,
        newInitiatives,
        newAreas,
      });
    }

    if (Object.prototype.hasOwnProperty.call(project, "name")) {
      nameUnsets.push(project._id);
    }
  }

  return { labelUpdates, nameUnsets, unmapped, warnings };
}

export async function planProjectLabelsToSlugMigration(): Promise<MigrationPlanResult> {
  const col = await getCollection<ProjectDoc>("projects");
  const [parents, projects] = await Promise.all([
    col.find({ type: { $in: ["bhag", "area"] } }).toArray(),
    col.find({}).toArray(),
  ]);

  const plan = computeProjectLabelsToSlugPlan(parents as ProjectDoc[], projects as ProjectDoc[]);

  const sampleDiffs: MigrationSampleDiff[] = plan.labelUpdates.slice(0, 10).map((u) => ({
    collection: "projects",
    id: u.slug,
    before: { "labels.initiatives": u.initiatives, "labels.areas": u.areas },
    after: { "labels.initiatives": u.newInitiatives, "labels.areas": u.newAreas },
  }));

  return {
    migration_id: PROJECT_LABELS_TO_SLUG_MIGRATION_ID,
    release: "0.6.0",
    schema_area: "tome_projects",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      projects_total: projects.length,
      label_updates_planned: plan.labelUpdates.length,
      name_unsets_planned: plan.nameUnsets.length,
      unmapped_labels: plan.unmapped.length,
    },
    warnings: plan.warnings,
    sample_diffs: sampleDiffs,
    tuple_writes_planned: 0,
    confirmation: PROJECT_LABELS_TO_SLUG_CONFIRMATION,
  };
}

export async function applyProjectLabelsToSlugMigration(input: {
  actor: string;
  now: string;
}): Promise<MigrationApplyResult> {
  const col = await getCollection<ProjectDoc>("projects");
  const [parents, projects] = await Promise.all([
    col.find({ type: { $in: ["bhag", "area"] } }).toArray(),
    col.find({}).toArray(),
  ]);

  const plan = computeProjectLabelsToSlugPlan(parents as ProjectDoc[], projects as ProjectDoc[]);
  const planResult = await planProjectLabelsToSlugMigration();

  let labelsUpdated = 0;
  for (const update of plan.labelUpdates) {
    await col.updateOne(
      { _id: update.id },
      {
        $set: {
          "labels.initiatives": update.newInitiatives,
          "labels.areas": update.newAreas,
        },
      },
    );
    labelsUpdated++;
  }

  // Unset legacy `name` field in batches of the ids collected above.
  let namesUnset = 0;
  if (plan.nameUnsets.length > 0) {
    for (const id of plan.nameUnsets) {
      await col.updateOne({ _id: id as ProjectDoc["_id"] }, { $unset: { name: "" } });
    }
    namesUnset = plan.nameUnsets.length;
  }

  return {
    ...planResult,
    applied_counts: {
      labels_updated: labelsUpdated,
      names_unset: namesUnset,
    },
    applied_at: input.now,
    applied_by: input.actor,
  };
}
