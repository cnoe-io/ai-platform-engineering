// Share a gist into the project's Feed (Mycelium room) as a linkable
// `gist_ref` typed message.
//
//   POST /api/tome/projects/[slug]/gists/[id]/share  → { message }

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getTomeGistsCollection } from "@/lib/tome/mongo-collections";
import { isMyceliumConfigured, postEvent } from "@/lib/tome/mycelium";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, id } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);

  if (!isMyceliumConfigured()) {
    throw new ApiError(
      "Mycelium is not configured (set MYCELIUM_URL).",
      503,
      "MYCELIUM_NOT_CONFIGURED",
    );
  }

  const gists = await getTomeGistsCollection();
  const gist = await gists.findOne({ _id: id, project_id: tctx.projectId });
  if (!gist) throw new ApiError("Gist not found", 404, "GIST_NOT_FOUND");

  const sender = tctx.user.email || "unknown";
  const viaBearer = (request.headers.get("Authorization") || "").startsWith("Bearer ");

  const message = await postEvent(slug, {
    sender_handle: sender,
    content: `shared gist "${gist.title}"`,
    kind: "gist_ref",
    payload: { gist_id: String(gist._id), title: gist.title },
  });

  auditTome({
    action: "tome.gist.share",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { gist_id: id, via: viaBearer ? "agent" : "web" },
  });

  return successResponse({ message }, 201);
});
