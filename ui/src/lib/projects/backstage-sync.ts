// assisted-by Cursor Composer

import type { BackstageSystemSummary } from "@/lib/projects/backstage-client";
import type { ProjectDocument } from "@/types/projects";

export type BackstageConflictResolution = "keep_local" | "use_backstage" | "merge";

export interface BackstageFieldConflict {
  field: string;
  local: string;
  backstage: string;
}

export interface BackstageSyncPreviewItem {
  slug: string;
  title: string;
  description: string;
  entity_ref: string;
  exists: boolean;
  has_conflict: boolean;
  conflicts: BackstageFieldConflict[];
}

const COMPARE_FIELDS = ["title", "description", "domain", "owner"] as const;

function fieldValue(
  project: ProjectDocument,
  field: (typeof COMPARE_FIELDS)[number],
): string {
  switch (field) {
    case "title":
      return project.title ?? "";
    case "description":
      return project.description ?? "";
    case "domain":
      return project.domain ?? "";
    case "owner":
      return project.catalog?.spec?.owner ?? "";
    default:
      return "";
  }
}

function backstageFieldValue(
  summary: BackstageSystemSummary,
  field: (typeof COMPARE_FIELDS)[number],
): string {
  switch (field) {
    case "title":
      return summary.title;
    case "description":
      return summary.description;
    case "domain":
      return summary.domain;
    case "owner":
      return summary.owner;
    default:
      return "";
  }
}

export function detectBackstageConflicts(
  local: ProjectDocument,
  summary: BackstageSystemSummary,
): BackstageFieldConflict[] {
  const conflicts: BackstageFieldConflict[] = [];
  for (const field of COMPARE_FIELDS) {
    const localValue = fieldValue(local, field).trim();
    const remoteValue = backstageFieldValue(summary, field).trim();
    if (localValue && remoteValue && localValue !== remoteValue) {
      conflicts.push({ field, local: localValue, backstage: remoteValue });
    }
  }
  return conflicts;
}

export function buildSyncPreview(
  summaries: BackstageSystemSummary[],
  existingBySlug: Map<string, ProjectDocument>,
): BackstageSyncPreviewItem[] {
  return summaries.map((summary) => {
    const existing = existingBySlug.get(summary.slug);
    const conflicts = existing
      ? detectBackstageConflicts(existing, summary)
      : [];
    return {
      slug: summary.slug,
      title: summary.title,
      description: summary.description,
      entity_ref: summary.entityRef,
      exists: Boolean(existing),
      has_conflict: conflicts.length > 0,
      conflicts,
    };
  });
}

export function applyBackstageToProject(
  local: ProjectDocument,
  summary: BackstageSystemSummary,
  resolution: BackstageConflictResolution,
  team?: { _id: string; name: string; slug: string },
): Partial<ProjectDocument> {
  if (resolution === "keep_local") {
    return {};
  }

  const patch: Partial<ProjectDocument> = {
    title: summary.title,
    description: summary.description,
    domain: summary.domain,
    tags: summary.tags,
    catalog: summary.catalog,
    components: summary.components,
    source: "backstage",
    backstage_entity_ref: summary.entityRef,
    updated_at: new Date(),
  };

  if (resolution === "merge" && team) {
    patch.team_id = team._id;
    patch.team_name = team.name;
    patch.team_slug = team.slug;
  } else if (resolution === "use_backstage" && team) {
    patch.team_id = team._id;
    patch.team_name = team.name;
    patch.team_slug = team.slug;
  }

  return patch;
}
