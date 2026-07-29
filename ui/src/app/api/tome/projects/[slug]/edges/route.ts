// This project's edges: outgoing (pages under its own `edges/` dir) and
// incoming (edges authored in OTHER projects whose `target` resolves here —
// see lib/tome/edges-index.ts for the backlink mechanism). Powers both the
// wiki tree (which already shows outgoing as ordinary pages) and the
// force-directed graph view.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { incomingEdgesFor } from "@/lib/tome/edges-index";
import { getPageStore } from "@/lib/tome/page-store";
import {
  EDGES_DIR,
  FM_CONFIDENCE,
  FM_EVIDENCE,
  FM_RELATION,
  FM_SOURCE,
  FM_STATUS,
  FM_TARGET,
  isEdge,
  parseFrontmatter,
  type FrontmatterValue,
} from "@/lib/tome/schema";
import { getCollection } from "@/lib/mongodb";
import { parseTomeHref } from "@/lib/tome/tome-links";
import { filterReadableTomeProjects } from "@/lib/tome/access";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import type { ProjectDocument } from "@/types/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function listOf(v: FrontmatterValue | undefined): string[] {
  return Array.isArray(v) ? v : v ? [String(v)] : [];
}

/** Frontmatter + prose body of an edge page, given its already-fetched markdown. */
function edgeDetail(md: string) {
  const [fm, body] = parseFrontmatter(md);
  if (!isEdge(fm)) return null;
  return {
    relation: String(fm[FM_RELATION] ?? "").trim(),
    source: String(fm[FM_SOURCE] ?? "").trim(),
    target: String(fm[FM_TARGET] ?? "").trim(),
    evidence: listOf(fm[FM_EVIDENCE]),
    confidence: String(fm[FM_CONFIDENCE] ?? "").trim() || null,
    status: String(fm[FM_STATUS] ?? "active").trim() || "active",
    body: body.trim(),
  };
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const { project, projectId } = tctx; // access check; throws if unauthorized

  const [allIncomingRows, pages] = await Promise.all([
    incomingEdgesFor(slug),
    (await getPageStore()).listPages(projectId),
  ]);
  const projects = await getCollection<ProjectDocument>("projects");
  const incomingSourceProjects = await projects
    .find({
      slug: {
        $in: [...new Set(allIncomingRows.map((row) => row.source_project_slug))],
      },
    })
    .toArray();
  const readableSources = await filterReadableTomeProjects(
    tomeSessionSubject(tctx.session),
    incomingSourceProjects,
    { isAdmin: tctx.canManageSteward },
  );
  const readableSourceSlugs = new Set(readableSources.map((row) => row.slug));
  const incomingRows = allIncomingRows.filter((row) =>
    readableSourceSlugs.has(row.source_project_slug),
  );

  const outgoing = Object.entries(pages)
    .filter(([path]) => path.startsWith(`${EDGES_DIR}/`))
    .map(([path, md]) => {
      const detail = edgeDetail(md);
      if (!detail) return null;
      return {
        path,
        ...detail,
        target_project_slug: parseTomeHref(detail.target)?.project ?? slug,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  // Incoming rows only carry the index's denormalized metadata (no body/
  // evidence — those live in the page itself), so re-read each edge page from
  // its owning (source) project to get the full picture.
  const store = await getPageStore();
  const incoming = (
    await Promise.all(
      incomingRows.map(async (row) => {
        // Backend-agnostic: any read failure (deleted page, stale index row,
        // whatever the active PageStore throws) just drops this edge from
        // the response rather than failing the whole graph.
        const md = await store.readPage(row.source_project_id, row.path).catch(() => null);
        if (md === null) return null;
        const detail = edgeDetail(md);
        if (!detail) return null;
        return { path: row.path, source_project_slug: row.source_project_slug, ...detail };
      }),
    )
  ).filter((e): e is NonNullable<typeof e> => e !== null);

  // Titles for every project mentioned, so the graph doesn't have to show
  // bare slugs.
  const slugs = new Set<string>([
    slug,
    ...outgoing.map((e) => e.target_project_slug),
    ...incoming.map((e) => e.source_project_slug),
  ]);
  const rows = await projects
    .find(
      { slug: { $in: [...slugs] } },
      { projection: { slug: 1, title: 1, name: 1, type: 1 } },
    )
    .toArray();
  const readableTitleRows = await filterReadableTomeProjects(
    tomeSessionSubject(tctx.session),
    rows,
    { isAdmin: tctx.canManageSteward },
  );
  const titles: Record<string, string> = { [slug]: project.title || project.name || slug };
  for (const r of readableTitleRows) titles[r.slug] = r.title || r.name || r.slug;

  return successResponse({ outgoing, incoming, titles });
});
