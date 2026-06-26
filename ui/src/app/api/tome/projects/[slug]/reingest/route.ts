// Kick an ingest run. POST { seed? } → { runId }. The agent stream is driven
// in the background; the browser polls the run for the live log.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { startIngestRun, IngestInProgressError } from "@/lib/tome/ingest-runner";

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

  const body = (await request.json().catch(() => ({}))) as {
    seed?: string;
    webexMeetings?: { id: string; title: string; start: string }[];
  };

  try {
    const { runId } = await startIngestRun(tctx, {
      seed: body.seed ?? null,
      webexMeetings: body.webexMeetings,
    });
    return successResponse({ runId });
  } catch (e) {
    if (e instanceof IngestInProgressError) {
      throw new ApiError(e.message, 409, "INGEST_IN_PROGRESS");
    }
    throw e;
  }
});
