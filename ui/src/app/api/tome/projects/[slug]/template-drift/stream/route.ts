// Streaming counterpart to ../route.ts, content-check only: the structural
// pass is instant so there's nothing to stream there. Proxies the agent's
// SSE `progress`/`done` events straight through so the panel can show
// per-page results as a content check runs instead of one long silent wait.

import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { buildSnapshot } from "@/lib/tome/agent-proxy";
import { getPageStore } from "@/lib/tome/page-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);

  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) {
    throw new ApiError(
      "Tome agent is not configured (set TOME_AGENT_URL).",
      503,
      "AGENT_NOT_CONFIGURED",
    );
  }

  const store = await getPageStore();
  const pages = await store.listPages(tctx.projectId);
  if (Object.keys(pages).length === 0) {
    throw new ApiError(
      "This wiki has no pages yet. Run an ingest first.",
      400,
      "EMPTY_WIKI",
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    contentCheckScope?: "out_of_date" | "all_bound";
  };

  const snapshot = buildSnapshot(tctx);
  const upstream = await fetch(`${agentUrl.replace(/\/$/, "")}/template-drift/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      snapshot,
      pages,
      content_check_scope: body.contentCheckScope ?? "out_of_date",
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    throw new ApiError(
      `Agent drift check failed (${upstream.status}). ${detail.slice(0, 500)}`,
      502,
      "AGENT_ERROR",
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
