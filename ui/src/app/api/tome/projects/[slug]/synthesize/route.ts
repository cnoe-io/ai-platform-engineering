// Kick a BHAG/Area synthesis run. POST { seed?, seedStablePages? } → { runId }.
// The agent synthesizes tagged child-project wikis plus direct sources.
// Distinct from /reingest (single-project source pull); both share the run
// lifecycle but drive different agent endpoints (/synthesize vs /ingest).

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { listReadableTomeProjects } from "@/lib/tome/access";
import { resolveAreaChildren, resolveBhagChildren } from "@/lib/tome/bhag";
import {
  getTomeProjectPermissions,
  tomeSessionSubject,
} from "@/lib/tome/data-steward";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import {
  startIngestRun,
  enqueueBhagCascade,
  isIngestRunning,
  IngestInProgressError,
} from "@/lib/tome/ingest-runner";
import type { ProjectDocument } from "@/types/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  // Synthesis is for BHAGs and Areas; regular projects ingest their sources via /reingest.
  if (tctx.project.type !== "bhag" && tctx.project.type !== "area") {
    throw new ApiError(
      "Synthesis is only for BHAGs and Areas. Use a normal ingest for projects.",
      400,
      "NOT_A_SYNTHESIZED_PROJECT",
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
    webexMeetings?: { id: string; title: string; start: string }[];
  };

  const childRefs =
    tctx.project.type === "area"
      ? await resolveAreaChildren(tctx.project.name)
      : await resolveBhagChildren(tctx.project.name);
  const readable = await listReadableTomeProjects(
    tomeSessionSubject(tctx.session),
    { isAdmin: tctx.canManageSteward },
  );
  const readableSlugs = new Set(readable.map((project) => project.slug));
  const blockedChildren = childRefs.filter(
    (child) => !readableSlugs.has(child.slug),
  );
  if (blockedChildren.length > 0) {
    throw new ApiError(
      `Synthesis cannot read: ${blockedChildren.map((child) => child.slug).join(", ")}`,
      403,
      "TOME_SYNTHESIS_SOURCE_READ_REQUIRED",
    );
  }

  if (body.refreshChildren && !tctx.canManageSteward && childRefs.length > 0) {
    const projects = await getCollection<ProjectDocument>("projects");
    const children = await projects
      .find({ slug: { $in: childRefs.map((child) => child.slug) } })
      .toArray();
    const decisions = await Promise.all(
      children.map((project) =>
        getTomeProjectPermissions({
          project,
          user: tctx.user,
          session: tctx.session,
        }),
      ),
    );
    const blockedWrites = children.filter((_, index) => !decisions[index].canEdit);
    if (blockedWrites.length > 0) {
      throw new ApiError(
        `Refreshing children requires stewardship of: ${blockedWrites
          .map((project) => project.slug)
          .join(", ")}`,
        403,
        "TOME_CHILD_STEWARD_REQUIRED",
      );
    }
  }

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
        webexMeetings: body.webexMeetings,
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
      webexMeetings: body.webexMeetings,
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
