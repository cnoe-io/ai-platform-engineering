// Generated Issues/Decisions board, including Area/BHAG roll-ups.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { normLabel } from "@/lib/projects/labels";
import { getPageStore } from "@/lib/tome/page-store";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { filterReadableTomeProjects } from "@/lib/tome/access";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import { TRACKED_ENTITY_PRIORITIES } from "@/lib/tome/schema";
import {
  isTrackedEntityPath,
  syncTrackedEntityIndex,
  trackedEntitiesForRollup,
} from "@/lib/tome/tracked-entities-index";
import type { ProjectDocument } from "@/types/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };
type ProjectRow = ProjectDocument & { _id: unknown };

function rollupProjects(current: ProjectDocument, all: ProjectRow[]): ProjectRow[] {
  const bySlug = new Map(all.map((project) => [project.slug, project]));
  const selected = new Set<string>([current.slug]);
  const currentName = normLabel(current.name || current.title || "");
  if (current.type === "area") {
    for (const project of all) {
      if ((project.labels?.areas ?? []).some((area) => normLabel(area) === currentName)) {
        selected.add(project.slug);
      }
    }
  } else if (current.type === "bhag") {
    const areaNames = new Set<string>();
    for (const project of all) {
      if (
        project.type === "area" &&
        (project.labels?.initiatives ?? []).some(
          (initiative) => normLabel(initiative) === currentName,
        )
      ) {
        selected.add(project.slug);
        areaNames.add(normLabel(project.name || project.title || ""));
      }
    }
    for (const project of all) {
      const directlyTagged = (project.labels?.initiatives ?? []).some(
        (initiative) => normLabel(initiative) === currentName,
      );
      const inChildArea = (project.labels?.areas ?? []).some((area) =>
        areaNames.has(normLabel(area)),
      );
      if (directlyTagged || inChildArea) selected.add(project.slug);
    }
  }
  return [...selected]
    .map((slug) => bySlug.get(slug))
    .filter((project): project is ProjectRow => Boolean(project));
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const projects = await getCollection<ProjectRow>("projects");
  const allProjects = await projects.find({}).toArray();
  const readableProjects = (await filterReadableTomeProjects(
    tomeSessionSubject(tctx.session),
    allProjects,
    { isAdmin: tctx.canManageSteward },
  )) as ProjectRow[];
  if (!readableProjects.some((project) => project.slug === tctx.project.slug)) {
    readableProjects.push(tctx.project as ProjectRow);
  }
  const rollup = rollupProjects(tctx.project, readableProjects);

  // Refresh relevant legacy pages lazily. New writes remain current through
  // PageStore's structured-index decorator.
  const store = await getPageStore();
  await Promise.all(
    rollup.map(async (project) => {
      const projectId = String(project._id);
      const pages = await store.listPages(projectId);
      await Promise.all(
        Object.entries(pages)
          .filter(([path]) => isTrackedEntityPath(path))
          .map(([path, markdown]) =>
            syncTrackedEntityIndex(projectId, project.slug, path, markdown),
          ),
      );
    }),
  );

  const rollupSlugs = rollup.map((project) => project.slug);
  const rows = await trackedEntitiesForRollup(rollupSlugs);
  const seen = new Set<string>();
  const items = rows
    .filter(
      (row) =>
        (TRACKED_ENTITY_PRIORITIES as readonly string[]).includes(row.priority) &&
        (row.entity_type === "issue" || row.entity_type === "decision"),
    )
    .filter((row) => {
      const key = String(row._id ?? `${row.source_project_id}:${row.path}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({
      id: String(row._id ?? `${row.source_project_id}:${row.path}`),
      type: row.entity_type,
      title: row.title,
      status: row.status,
      priority: row.priority,
      owner: row.owner ?? null,
      opened: row.opened ?? null,
      closed: row.closed ?? null,
      target: row.target ?? null,
      body: row.body,
      source_project_slug: row.source_project_slug,
      path: row.path,
    }));
  return successResponse({ items, rollup_project_slugs: rollupSlugs });
});
