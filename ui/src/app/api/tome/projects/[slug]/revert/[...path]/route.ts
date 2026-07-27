// Revert a page to a prior revision's body — a new append-only write, not a
// destructive rewrite. Body = { revisionId }. Editor-gated; blocked while the
// project is locked, same as a manual edit. Sibling to pages/[...path] and
// history/[...path] (a route nested under pages/[...path]/revert would put a
// static segment after a catch-all, which Next.js rejects).

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor, guardNotLocked } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getPageStore } from "@/lib/tome/page-store";
import { PageNotFoundError } from "@/lib/tome/mongo-page-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, path } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  await guardNotLocked(tctx.projectId, tctx.project.locked ?? false);
  const pagePath = path.join("/");

  const body = (await request.json().catch(() => ({}))) as { revisionId?: string };
  if (typeof body.revisionId !== "string" || !body.revisionId) {
    throw new ApiError("`revisionId` (string) is required", 400, "BAD_REQUEST");
  }

  const store = await getPageStore();
  try {
    await store.revertPage(tctx.projectId, pagePath, body.revisionId, {
      author: tctx.user.email ?? "tome",
    });
  } catch (err) {
    if (err instanceof PageNotFoundError) {
      throw new ApiError("Revision not found", 404, "REVISION_NOT_FOUND");
    }
    throw err;
  }

  auditTome({
    action: "tome.page.revert",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    page: pagePath,
    metadata: { revision_id: body.revisionId },
  });

  return successResponse({ ok: true, path: pagePath });
});
