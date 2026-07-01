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

  // A BHAG has no sources to ingest — its wiki is a synthesis of the projects
  // tagged to it. Route those runs through the dedicated /synthesize endpoint.
  if (tctx.project.type === "bhag") {
    throw new ApiError(
      "BHAGs don't ingest sources. Use BHAG synthesis instead.",
      400,
      "USE_SYNTHESIS",
    );
  }

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
    seedStablePages?: boolean;
  };

  try {
    const { runId } = await startIngestRun(tctx, {
      seed: body.seed ?? null,
      webexMeetings: body.webexMeetings,
      seedStablePages: body.seedStablePages,
    });
    return successResponse({ runId });
  } catch (e) {
    if (e instanceof IngestInProgressError) {
      throw new ApiError(e.message, 409, "INGEST_IN_PROGRESS");
    }
    throw e;
  }
});
