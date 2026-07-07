// Status of one BHAG synthesize cascade: the parent synthesize run plus each
// child re-ingest, with project names. Polled by the BHAG run view so the user
// sees which children are queued / running / done.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import type { ProjectDocument } from "@/types/projects";
import type { IngestRun } from "@/types/tome";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; cascadeId: string }> };

function summarize(run: IngestRun, name: string, slug: string) {
  return {
    id: String(run._id),
    project_id: run.project_id,
    name,
    slug,
    role: run.cascade_role ?? null,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at ?? null,
    error: run.error ?? null,
  };
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, cascadeId } = await ctx.params;
  await loadTomeProject(request, slug); // auth + feature gate

  const runs = await getTomeIngestRunsCollection();
  const rows = await runs.find({ cascade_id: cascadeId }).toArray();
  if (rows.length === 0) {
    throw new ApiError("Cascade not found", 404, "CASCADE_NOT_FOUND");
  }

  // Resolve project names + slugs for everything in the cascade in one pass.
  const projects = await getCollection<ProjectDocument>("projects");
  const all = await projects.find({}).project({ slug: 1, title: 1, name: 1 }).toArray();
  const nameById = new Map(
    all.map((p) => [String(p._id), (p.title || p.name || String(p._id)) as string]),
  );
  const slugById = new Map(all.map((p) => [String(p._id), (p.slug || String(p._id)) as string]));

  const parent = rows.find((r) => r.cascade_role === "parent");
  const children = rows
    .filter((r) => r.cascade_role === "child")
    .map((r) =>
      summarize(r, nameById.get(r.project_id) ?? r.project_id, slugById.get(r.project_id) ?? r.project_id),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return successResponse({
    cascade_id: cascadeId,
    parent: parent
      ? summarize(
          parent,
          nameById.get(parent.project_id) ?? parent.project_id,
          slugById.get(parent.project_id) ?? parent.project_id,
        )
      : null,
    children,
    counts: {
      total: children.length,
      succeeded: children.filter((c) => c.status === "succeeded").length,
      failed: children.filter((c) => c.status === "failed").length,
      running: children.filter((c) => c.status === "running").length,
      queued: children.filter((c) => c.status === "queued").length,
    },
  });
});
