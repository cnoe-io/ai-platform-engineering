// One gist — fetch, edit, or delete.
//
//   GET    /api/tome/projects/[slug]/gists/[id]  → { gist }
//   PATCH  /api/tome/projects/[slug]/gists/[id]  → { gist }
//   DELETE /api/tome/projects/[slug]/gists/[id]  → { ok: true }

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { normalizeGistTags } from "@/lib/tome/gists";
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
      updated_at: gist.updated_at,
      updated_by: gist.updated_by,
      tags: gist.tags ?? [],
      path: `/projects/${slug}/tome/gists/${gist._id}`,
    },
  });
});

export const PATCH = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, id } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    body?: unknown;
    tags?: unknown;
  } | null;
  if (!body) throw new ApiError("Request body must be JSON", 400, "BAD_REQUEST");
  if (body.title === undefined && body.body === undefined && body.tags === undefined) {
    throw new ApiError(
      "Provide at least one of title, body, or tags",
      400,
      "BAD_REQUEST",
    );
  }

  const update: {
    title?: string;
    body?: string;
    tags?: string[];
    updated_at: Date;
    updated_by: string;
  } = {
    updated_at: new Date(),
    updated_by: tctx.user.email || "unknown",
  };
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      throw new ApiError("`title` must be a non-empty string", 400, "BAD_REQUEST");
    }
    update.title = body.title.trim();
  }
  if (body.body !== undefined) {
    if (typeof body.body !== "string" || !body.body.trim()) {
      throw new ApiError("`body` must be a non-empty string", 400, "BAD_REQUEST");
    }
    update.body = body.body;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      throw new ApiError("`tags` must be an array", 400, "BAD_REQUEST");
    }
    update.tags = normalizeGistTags(body.tags);
  }

  const gists = await getTomeGistsCollection();
  const gist = await gists.findOne({ _id: id, project_id: tctx.projectId });
  if (!gist) throw new ApiError("Gist not found", 404, "GIST_NOT_FOUND");

  await gists.updateOne(
    { _id: id, project_id: tctx.projectId },
    { $set: update },
  );
  const updated = { ...gist, ...update };

  auditTome({
    action: "tome.gist.update",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: {
      gist_id: id,
      changed_fields: ["title", "body", "tags"].filter(
        (field) => body[field as keyof typeof body] !== undefined,
      ),
    },
  });

  return successResponse({
    gist: {
      id: String(updated._id),
      title: updated.title,
      body: updated.body,
      author: updated.author,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
      updated_by: updated.updated_by,
      tags: updated.tags ?? [],
      path: `/projects/${slug}/tome/gists/${updated._id}`,
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
