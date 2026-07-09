// Tome gists — lightweight, shareable context chunks that stay OUT of the
// wiki/ingest/agent-context by default. A stored, linkable chunk a teammate
// pulls in only when relevant, never auto-loaded.
//
//   GET  /api/tome/projects/[slug]/gists       → { gists }  (newest first)
//   POST /api/tome/projects/[slug]/gists       → { gist }   (create)

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getTomeGistsCollection } from "@/lib/tome/mongo-collections";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const { projectId } = await loadTomeProject(request, slug);

  const gists = await getTomeGistsCollection();
  const rows = await gists
    .find({ project_id: projectId })
    .sort({ created_at: -1 })
    .toArray();

  return successResponse({
    gists: rows.map((g) => ({
      id: String(g._id),
      title: g.title,
      body: g.body,
      author: g.author,
      created_at: g.created_at,
    })),
  });
});

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
  };
  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    throw new ApiError("`title` (string) is required", 400, "BAD_REQUEST");
  }
  if (!body.body || typeof body.body !== "string" || !body.body.trim()) {
    throw new ApiError("`body` (string) is required", 400, "BAD_REQUEST");
  }

  const gists = await getTomeGistsCollection();
  const gist = {
    _id: randomUUID(),
    project_id: tctx.projectId,
    title: body.title.trim(),
    body: body.body,
    author: tctx.user.email || "unknown",
    created_at: new Date(),
  };
  await gists.insertOne(gist);

  auditTome({
    action: "tome.gist.create",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { gist_id: gist._id },
  });

  return successResponse({ gist: { ...gist, id: gist._id } }, 201);
});
