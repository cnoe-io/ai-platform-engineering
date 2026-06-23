// A single page revision's body — used by the diff view to fetch the two sides.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getPageStore } from "@/lib/tome/page-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, id } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);

  const store = await getPageStore();
  const rev = await store.readRevision(projectId, id);
  if (!rev) {
    throw new ApiError("Revision not found", 404, "REVISION_NOT_FOUND");
  }

  return successResponse({
    id: String(rev._id),
    path: rev.path,
    author: rev.author,
    message: rev.message,
    created_at: rev.created_at,
    deleted: Boolean(rev.deleted),
    body: rev.deleted ? "" : (rev.markdown ?? ""),
  });
});
