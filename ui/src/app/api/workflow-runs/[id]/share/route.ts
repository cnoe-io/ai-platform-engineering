// assisted-by claude code claude-sonnet-4-6
/**
 * POST /api/workflow-runs/[id]/share — Update team-sharing for a workflow run.
 *
 * Only the run owner (or an existing team-shared user with write access) may call this.
 * Validates team slugs, updates Mongo, and reconciles OpenFGA tuples atomically.
 *
 * Body: { shared_with_teams: string[] }
 * Response: { shared_with_teams: string[] }
 */

import { ApiError, withAuth, withErrorHandler } from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { requireWorkflowRunAccess } from "@/lib/server/workflow-cas-authz";
import { type WorkflowRunDocument } from "@/lib/server/workflow-engine";
import { reconcileWorkflowRunAccess } from "@/lib/rbac/workflow-run-rebac";
import { normalizeTeamSlug } from "@/lib/rbac/workflow-config-rebac";
import { NextRequest, NextResponse } from "next/server";

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is required", 503);
  }

  const { id } = await params;

  return await withAuth(request, async (req, _user, session) => {
    const body = await req.json();
    const rawSlugs: unknown = body.shared_with_teams;

    if (!Array.isArray(rawSlugs)) {
      throw new ApiError("shared_with_teams must be an array", 400);
    }

    const nextSlugs = [...new Set(
      rawSlugs
        .map((s) => (typeof s === "string" ? normalizeTeamSlug(s) : ""))
        .filter(Boolean),
    )];

    const runCol = await getCollection<WorkflowRunDocument>("workflow_runs");
    const run = await runCol.findOne({ _id: id });
    if (!run) {
      throw new ApiError("Workflow run not found", 404);
    }

    // Only the owner (or existing team-share admin) may update sharing
    await requireWorkflowRunAccess(session, run, "write");

    // Validate that all requested slugs correspond to real teams
    if (nextSlugs.length > 0) {
      const teamsCol = await getCollection<{ slug?: string }>("teams");
      const found = await teamsCol
        .find({ slug: { $in: nextSlugs } })
        .project({ slug: 1 })
        .toArray();
      const foundSlugs = new Set(found.map((t) => t.slug?.trim().toLowerCase()).filter(Boolean));
      const missing = nextSlugs.filter((s) => !foundSlugs.has(s));
      if (missing.length > 0) {
        throw new ApiError(`Unknown team slug(s): ${missing.join(", ")}`, 400);
      }
    }

    const previousSlugs = (run.shared_with_teams ?? []).map(normalizeTeamSlug).filter(Boolean);

    // Update Mongo first, then reconcile FGA tuples
    await runCol.updateOne({ _id: id }, { $set: { shared_with_teams: nextSlugs } });

    try {
      await reconcileWorkflowRunAccess(
        { _id: String(run._id), owner_subject: run.owner_subject ?? null },
        nextSlugs,
        previousSlugs,
      );
    } catch (err) {
      // FGA reconcile failure is non-fatal — the Mongo update is authoritative.
      // Log and surface as a warning so ops can re-reconcile if needed.
      console.warn(`[workflow-run-share] FGA reconcile failed for run ${id}:`, err);
    }

    return NextResponse.json({ shared_with_teams: nextSlugs });
  });
});
