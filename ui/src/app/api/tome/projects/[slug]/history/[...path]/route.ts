// Revision history for one page (newest first) — summaries for the diff/history
// view. Revisions carry `report_id` when produced by an ingest, so an ingest's
// changes are attributable.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getPageStore } from "@/lib/tome/page-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, path } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);
  const pagePath = path.join("/");

  const store = await getPageStore();
  const revisions = await store.pageHistory(projectId, pagePath);

  const summaries = revisions.map((r) => ({
    id: String(r._id),
    author: r.author,
    message: r.message,
    created_at: r.created_at,
    report_id: r.report_id ?? null,
    deleted: Boolean(r.deleted),
  }));

  return successResponse({ path: pagePath, revisions: summaries });
});
