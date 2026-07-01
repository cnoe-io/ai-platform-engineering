// Kick a compaction run. POST { seed? } → { runId }. Compaction is an in-place
// editing pass: it tightens the prose of dynamic wiki pages and fixes stale
// tome:// links. It pulls no sources and removes no pages. Shares the run
// lifecycle with ingest/synthesize; drives the agent's /compact endpoint.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { startIngestRun, IngestInProgressError } from "@/lib/tome/ingest-runner";
import { getPageStore } from "@/lib/tome/page-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  if (!process.env.TOME_AGENT_URL) {
    throw new ApiError(
      "Tome agent is not configured (set TOME_AGENT_URL).",
      503,
      "AGENT_NOT_CONFIGURED",
    );
  }

  // Nothing to compact until the wiki has pages. Guards against running it on a
  // never-ingested project (which would otherwise create an empty report).
  const store = await getPageStore();
  const pages = await store.listPages(tctx.projectId);
  if (Object.keys(pages).length === 0) {
    throw new ApiError(
      "This wiki has no pages yet. Run an ingest first.",
      400,
      "EMPTY_WIKI",
    );
  }

  const body = (await request.json().catch(() => ({}))) as { seed?: string };

  try {
    const { runId } = await startIngestRun(tctx, {
      seed: body.seed ?? null,
      agentEndpoint: "/compact",
    });
    return successResponse({ runId });
  } catch (e) {
    if (e instanceof IngestInProgressError) {
      throw new ApiError(e.message, 409, "INGEST_IN_PROGRESS");
    }
    throw e;
  }
});
