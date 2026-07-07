// Kick a BHAG synthesis run. POST { seed?, seedStablePages? } → { runId }. A BHAG
// has no sources — this synthesizes its wiki from the projects tagged to it.
// Distinct from /reingest (single-project source pull); both share the run
// lifecycle but drive different agent endpoints (/synthesize vs /ingest).

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import {
  startIngestRun,
  enqueueBhagCascade,
  isIngestRunning,
  IngestInProgressError,
} from "@/lib/tome/ingest-runner";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  // Synthesis is BHAG-only; regular projects ingest their sources via /reingest.
  if (tctx.project.type !== "bhag") {
    throw new ApiError(
      "Synthesis is only for BHAGs. Use a normal ingest for projects.",
      400,
      "NOT_A_BHAG",
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
    seedStablePages?: boolean;
    /** Re-ingest every child project first, then synthesize (a cascade). */
    refreshChildren?: boolean;
  };

  try {
    // Cascade: enqueue a re-ingest per child, then the synthesize. The queue
    // worker drains them; the parent runs once all children are terminal.
    if (body.refreshChildren) {
      if (await isIngestRunning(tctx.projectId)) {
        throw new IngestInProgressError();
      }
      const { parentRunId, cascadeId, childCount } = await enqueueBhagCascade(tctx, {
        seed: body.seed ?? null,
        seedStablePages: body.seedStablePages,
      });
      auditTome({
        action: "tome.synthesize.trigger",
        actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
        projectSlug: slug,
        metadata: { run_id: parentRunId, cascade_id: cascadeId, child_count: childCount, refresh_children: true },
      });
      return successResponse({ runId: parentRunId, cascadeId, childCount });
    }

    const { runId } = await startIngestRun(tctx, {
      seed: body.seed ?? null,
      seedStablePages: body.seedStablePages,
      agentEndpoint: "/synthesize",
    });
    auditTome({
      action: "tome.synthesize.trigger",
      actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
      projectSlug: slug,
      metadata: { run_id: runId, seeded: Boolean(body.seed) },
    });
    return successResponse({ runId });
  } catch (e) {
    if (e instanceof IngestInProgressError) {
      throw new ApiError(e.message, 409, "INGEST_IN_PROGRESS");
    }
    throw e;
  }
});
