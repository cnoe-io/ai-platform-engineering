// Internal agent callback: POST a page write (the agent's persist hook).
// Body = WritePageRequest { path, body, message, author, report_id? }.
// Matches agent/http_client.py write_page.

import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";
import { getPageStore } from "@/lib/tome/page-store";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { canWriteAs } from "@/lib/tome/data-steward";
import {
  getExperiment,
  getExperimentArtifact,
  writeExperimentArtifactPage,
} from "@/lib/tome/evaluation-store";
import { parseFrontmatter, SPEC_BY_PATH } from "@/lib/tome/schema";
import type { TomeReviewMode } from "@/types/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// All current pages as a `{ path: markdown }` map. The agent calls this at the
// start of each chat/ingest turn to rehydrate its `/project` working copy from
// the source of truth (Mongo), so it never reads stale files.
export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id } = await ctx.params;
  const project = await resolveProject(id);
  const store = await getPageStore();
  const pages = await store.listPages(project._id);
  return Response.json(pages);
});

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id } = await ctx.params;
  const project = await resolveProject(id);

  const body = (await request.json().catch(() => ({}))) as {
    path?: string;
    body?: string;
    message?: string;
    author?: string;
    report_id?: string | null;
    actor_sub?: string | null;
    experiment_id?: string | null;
    artifact_id?: string | null;
  };
  if (typeof body.path !== "string" || typeof body.body !== "string") {
    throw new ApiError("`path` and `body` are required", 400, "BAD_REQUEST");
  }

  // Experiment writes are isolated by construction: validate both foreign
  // keys and persist only to the candidate artifact collection. They never
  // become PageRevisions and therefore cannot appear in the wiki or history.
  if (body.experiment_id || body.artifact_id) {
    if (!body.experiment_id || !body.artifact_id) {
      throw new ApiError(
        "Both `experiment_id` and `artifact_id` are required",
        400,
        "BAD_EXPERIMENT_WRITE",
      );
    }
    const [experiment, artifact] = await Promise.all([
      getExperiment(body.experiment_id),
      getExperimentArtifact(body.artifact_id),
    ]);
    if (
      !experiment ||
      !artifact ||
      experiment.project_id !== project._id ||
      artifact.project_id !== project._id ||
      artifact.experiment_id !== experiment._id
    ) {
      throw new ApiError(
        "Experiment artifact does not belong to this project",
        404,
        "EXPERIMENT_ARTIFACT_NOT_FOUND",
      );
    }
    if (experiment.config?.evaluation_mode === "quick") {
      const allowedPaths = new Set(experiment.config.evaluation_page_scope?.paths ?? []);
      if (!allowedPaths.has(body.path)) {
        throw new ApiError(
          `Quick evaluation writes are limited to selected pages; rejected ${body.path}`,
          403,
          "QUICK_EVALUATION_PAGE_SCOPE",
        );
      }
    }
    await writeExperimentArtifactPage(body.artifact_id, body.path, body.body);
    return Response.json({ ok: true, isolated: true });
  }

  // Chat-initiated writes (no report_id) carry actor_sub so we can enforce
  // FGA can_write. Ingest writes are already gated (requireTomeEditor on the
  // ingest dispatch route), so they skip this check.
  if (!body.report_id) {
    if (!body.actor_sub) {
      throw new ApiError(
        "Only a data steward may edit pages via the chat agent",
        403,
        "DATA_STEWARD_REQUIRED",
      );
    }
    const allowed = await canWriteAs(body.actor_sub, project);
    if (!allowed) {
      throw new ApiError(
        "Only a data steward may edit pages via the chat agent",
        403,
        "DATA_STEWARD_REQUIRED",
      );
    }
  }

  const status = await draftStatusForWrite({
    reportId: body.report_id ?? undefined,
    reviewMode: project.review_mode,
    path: body.path,
    markdown: body.body,
  });

  const store = await getPageStore();
  await store.writePage(project._id, body.path, body.body, {
    message: body.message || `agent wrote ${body.path}`,
    author: body.author || "tome-agent",
    reportId: body.report_id ?? undefined,
    ...(status === "draft" ? { status: "draft" as const } : {}),
  });
  return Response.json({ ok: true });
});

/** True if `path`/`markdown` resolve to `kind: stable` (or `hidden` — same
 *  preserve-on-incremental semantics), same rule `buildTree` uses: explicit
 *  frontmatter wins, else the page's template spec, else "stable". */
function isStableWrite(path: string, markdown: string): boolean {
  const [fm] = parseFrontmatter(markdown);
  const rawKind = fm.kind;
  if (typeof rawKind === "string") return rawKind === "stable" || rawKind === "hidden";
  const spec = SPEC_BY_PATH.get(path);
  return !spec || spec.kind === "stable" || spec.kind === "hidden";
}

/**
 * Whether this write should land as a "draft" (held for human review) or
 * straight to "live", combining three gates in precedence order:
 *
 * 1. Enforced quality policies always draft; lower-precedence settings cannot
 *    publish before that gate is satisfied.
 * 2. An ingest run's opt-out (`dispatch.skipReview`) — set on the run that
 *    owns `reportId`, if any — bypasses project review.
 * 3. The project's own `review_mode` setting (#291): `none` never drafts,
 *    `all` always drafts, `stable_only` (the default) drafts only when the
 *    write targets a stable/hidden page. Applies to every write path (chat,
 *    MCP edit, ingest) since they all funnel through this one endpoint.
 */
async function draftStatusForWrite(args: {
  reportId: string | undefined;
  reviewMode: TomeReviewMode | undefined;
  path: string;
  markdown: string;
}): Promise<"live" | "draft"> {
  if (args.reportId) {
    const runs = await getTomeIngestRunsCollection();
    const run = await runs.findOne({ report_id: args.reportId });
    // Quality-policy enforcement is stronger than both the project setting
    // and a caller's run-level opt-out. createRunRecord also forces
    // skipReview=false for these runs; keep the write path independently
    // defensive so an enforced evaluation can never publish directly live.
    if (
      run?.quality_policy_mode === "enforce" ||
      (run?.quality_policy_mode !== undefined &&
        run.quality_policy_mode !== "off" &&
        run.quality_require_human_review)
    ) {
      return "draft";
    }
    if (run?.dispatch?.skipReview) return "live";
  }

  const mode = args.reviewMode ?? "stable_only";
  if (mode === "none") return "live";
  if (mode === "all") return "draft";
  return isStableWrite(args.path, args.markdown) ? "draft" : "live";
}

// Tombstone a page (soft delete — appends a deleted revision). The agent's
// delete_page tool enforces the protected-class guard (stable/hidden/template)
// before calling; this endpoint is the tombstone op and is agent-token gated.
// No `locked` check: the agent deletes DURING an ingest, which holds the lock.
export const DELETE = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  requireAgentToken(request);
  const { id } = await ctx.params;
  const project = await resolveProject(id);

  const path = request.nextUrl.searchParams.get("path");
  if (!path) {
    throw new ApiError("`path` query param is required", 400, "BAD_REQUEST");
  }
  const author = request.nextUrl.searchParams.get("author") || "tome-agent";
  const message = request.nextUrl.searchParams.get("message") || undefined;

  const store = await getPageStore();
  await store.deletePage(project._id, path, { author, message });
  return Response.json({ deleted: true, path });
});
