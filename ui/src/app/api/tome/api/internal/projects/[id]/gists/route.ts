// Internal agent callback: read a project's gists. Agent-token gated, same
// pattern as the pages/snapshot internal endpoints — the chat agent has no
// other way to see gists (they're deliberately kept out of ingest/agent
// context by default, discoverable only via the Feed, MCP, or now here).
//
//   GET /api/tome/api/internal/projects/[id]/gists           → { gists }
//   GET /api/tome/api/internal/projects/[id]/gists?id=<gist> → { gist }

import { NextRequest } from "next/server";

import { withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";
import { getTomeGistsCollection } from "@/lib/tome/mongo-collections";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id } = await ctx.params;
  const project = await resolveProject(id);

  const gistId = request.nextUrl.searchParams.get("id");
  const gists = await getTomeGistsCollection();

  if (gistId) {
    const g = await gists.findOne({ _id: gistId, project_id: project._id });
    if (!g) return Response.json({ gist: null });
    return Response.json({
      gist: {
        id: String(g._id),
        title: g.title,
        body: g.body,
        author: g.author,
        created_at: g.created_at,
        tags: g.tags ?? [],
      },
    });
  }

  const rows = await gists
    .find({ project_id: project._id })
    .sort({ created_at: -1 })
    .toArray();
  return Response.json({
    gists: rows.map((g) => ({
      id: String(g._id),
      title: g.title,
      author: g.author,
      created_at: g.created_at,
      tags: g.tags ?? [],
    })),
  });
});
