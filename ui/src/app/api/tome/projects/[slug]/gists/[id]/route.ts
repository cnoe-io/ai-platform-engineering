// One gist — fetch or delete.
//
//   GET    /api/tome/projects/[slug]/gists/[id]  → { gist }
//   DELETE /api/tome/projects/[slug]/gists/[id]  → { ok: true }

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getTomeGistsCollection } from "@/lib/tome/mongo-collections";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, id } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);

  const gists = await getTomeGistsCollection();
  const gist = await gists.findOne({ _id: id, project_id: projectId });
  if (!gist) throw new ApiError("Gist not found", 404, "GIST_NOT_FOUND");

  return successResponse({
    gist: {
      id: String(gist._id),
      title: gist.title,
      body: gist.body,
      author: gist.author,
      created_at: gist.created_at,
      tags: gist.tags ?? [],
      path: `/projects/${slug}/tome/gists/${gist._id}`,
    },
  });
});

export const DELETE = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, id } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const gists = await getTomeGistsCollection();
  const gist = await gists.findOne({ _id: id, project_id: tctx.projectId });
  if (!gist) throw new ApiError("Gist not found", 404, "GIST_NOT_FOUND");

  await gists.deleteOne({ _id: id, project_id: tctx.projectId });

  auditTome({
    action: "tome.gist.delete",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { gist_id: id },
  });

  return successResponse({ ok: true });
});
