// Tome gists — lightweight, shareable context chunks that stay OUT of the
// wiki/ingest/agent-context by default. A stored, linkable chunk a teammate
// pulls in only when relevant, never auto-loaded. Every gist is posted to the
// project's Feed as a `gist_ref` message at creation time — sharing isn't a
// separate step, it's how a gist becomes discoverable at all.
//
//   GET  /api/tome/projects/[slug]/gists       → { gists }  (newest first)
//   POST /api/tome/projects/[slug]/gists       → { gist }   (create + share)

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getTomeGistsCollection } from "@/lib/tome/mongo-collections";
import { isMyceliumConfigured, postEvent } from "@/lib/tome/mycelium";
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
      path: `/projects/${slug}/tome/gists/${g._id}`,
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

  const actor = tomeActorFromAuth({ user: tctx.user, session: tctx.session });
  auditTome({
    action: "tome.gist.create",
    actor,
    projectSlug: slug,
    metadata: { gist_id: gist._id },
  });

  // Sharing is not opt-in — a gist only becomes discoverable via the Feed
  // (or the MCP list/get tools), so every creation posts a `gist_ref`
  // message. Best-effort: a Mycelium hiccup shouldn't fail the save itself.
  if (isMyceliumConfigured()) {
    try {
      await postEvent(slug, {
        sender_handle: gist.author,
        content: `shared gist "${gist.title}"`,
        kind: "gist_ref",
        payload: { gist_id: gist._id, title: gist.title },
      });
      auditTome({
        action: "tome.gist.share",
        actor,
        projectSlug: slug,
        metadata: { gist_id: gist._id },
      });
    } catch (err) {
      console.warn("[tome-gists] failed to post gist_ref to the Feed", err);
    }
  }

  return successResponse(
    { gist: { ...gist, id: gist._id, path: `/projects/${slug}/tome/gists/${gist._id}` } },
    201,
  );
});
