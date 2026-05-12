/**
 * Workflow Runs API Routes (v2)
 *
 * POST /api/workflow-runs — Start a new workflow run (fire-and-forget via engine)
 * GET  /api/workflow-runs?run_id=X — Poll run status + events (new engine format)
 * GET  /api/workflow-runs — List runs for current user (legacy compat)
 * PUT  /api/workflow-runs?id=X — Update a run (legacy compat)
 * DELETE /api/workflow-runs?id=X — Delete a run (legacy compat)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  getAuthFromBearerOrSession,
} from "@/lib/api-middleware";
import {
  startWorkflowRun,
  detectStaleRun,
  type WorkflowRunDocument,
} from "@/lib/server/workflow-engine";
import { readEventsByRun, deleteEventsByRun } from "@/lib/server/event-store";
import type { WorkflowConfig } from "@/types/workflow-config";

const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : "none";

/** Days to retain workflow runs before auto-cleanup. 0 = disabled. */
const RETENTION_DAYS = parseInt(process.env.WORKFLOW_RUN_RETENTION_DAYS ?? "7", 10);

/** Throttle cleanup to run at most once per 30 minutes */
let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Opportunistic cleanup of expired workflow runs.
 * Deletes runs older than RETENTION_DAYS along with their files and events.
 * Runs at most once every 5 minutes, fire-and-forget.
 */
async function cleanupExpiredRuns(): Promise<void> {
  if (RETENTION_DAYS <= 0) return;

  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  try {
    const col = await getCollection<WorkflowRunDocument>("workflow_runs");
    const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const expiredRuns = await col
      .find({
        status: { $in: ["completed", "failed"] },
        $or: [
          { completed_at: { $lt: cutoff } },
          { started_at: { $lt: cutoff }, completed_at: null },
        ],
      })
      .project({ _id: 1, workflow_config_id: 1 })
      .toArray();

    if (expiredRuns.length === 0) return;

    const daUrl = process.env.DYNAMIC_AGENTS_URL || "http://localhost:8100";

    for (const run of expiredRuns) {
      const runId = run._id as string;
      // Clean up files (best-effort)
      try {
        const fsNamespace = JSON.stringify([run.workflow_config_id, runId, "filesystem"]);
        await fetch(
          `${daUrl}/api/v1/files/namespace?fs_namespace=${encodeURIComponent(fsNamespace)}`,
          { method: "DELETE" },
        );
      } catch { /* best-effort */ }

      // Clean up events (best-effort)
      try {
        await deleteEventsByRun(runId);
      } catch { /* best-effort */ }
    }

    // Bulk delete the run documents
    const ids = expiredRuns.map((r) => r._id);
    await col.deleteMany({ _id: { $in: ids } });

    console.log(`[workflow-cleanup] Deleted ${expiredRuns.length} expired workflow runs (retention: ${RETENTION_DAYS}d)`);
  } catch (err) {
    console.warn("[workflow-cleanup] Error during cleanup:", err);
  }
}

// ═══════════════════════════════════════════════════════════════
// POST — Start a new workflow run
// ═══════════════════════════════════════════════════════════════

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("MongoDB is required for workflow runs", 503);
  }

  const { user } = await getAuthFromBearerOrSession(request);
  const body = await request.json();
  const { workflow_config_id, user_context } = body;

  if (!workflow_config_id) {
    throw new ApiError("workflow_config_id is required", 400);
  }

  // Load config
  const configCol = await getCollection<WorkflowConfig>("workflow_configs");
  const config = await configCol.findOne({ _id: workflow_config_id });
  if (!config) {
    throw new ApiError(`Workflow config ${workflow_config_id} not found`, 404);
  }

  // Build auth headers for DA server calls
  const authHeaders: Record<string, string> = {};
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    authHeaders["Authorization"] = authHeader;
  }
  authHeaders["X-User-Context"] = Buffer.from(JSON.stringify({
    email: user.email,
    name: user.name,
  })).toString("base64");

  const runId = await startWorkflowRun(config, user_context || null, authHeaders);

  return NextResponse.json({ run_id: runId, status: "running" }, { status: 201 });
});

// ═══════════════════════════════════════════════════════════════
// GET — Poll run status + events (by run_id) or list runs
// ═══════════════════════════════════════════════════════════════

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("MongoDB is required for workflow runs", 503);
  }

  await getAuthFromBearerOrSession(request);

  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("run_id");

  if (runId) {
    // v2: Poll a specific run with events
    const col = await getCollection<WorkflowRunDocument>("workflow_runs");
    const run = await col.findOne({ _id: runId });
    if (!run) {
      throw new ApiError(`Run ${runId} not found`, 404);
    }

    // Detect stale runs
    const isStale = await detectStaleRun(run);
    if (isStale) {
      run.status = "failed";
    }

    // Load events for all steps
    const events = await readEventsByRun(runId);
    const eventsObj: Record<number, unknown[]> = {};
    for (const [stepIndex, stepEvents] of events) {
      eventsObj[stepIndex] = stepEvents;
    }

    return NextResponse.json({ ...run, events: eventsObj }) as NextResponse;
  }

  // Legacy: list runs for user
  return await withAuth(request, async (_req, user) => {
    // Fire-and-forget cleanup of expired runs
    cleanupExpiredRuns().catch(() => {});

    const col = await getCollection<WorkflowRunDocument>("workflow_runs");
    const runs = await col
      .find({})
      .sort({ started_at: -1 })
      .limit(100)
      .toArray();
    return NextResponse.json(runs) as NextResponse;
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT — Update a run (legacy compat)
// ═══════════════════════════════════════════════════════════════

export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("MongoDB is required for workflow runs", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    throw new ApiError("Workflow run ID is required", 400);
  }

  return await withAuth(request, async (_req, user) => {
    const body = await request.json();
    if (Object.keys(body).length === 0) {
      throw new ApiError("At least one field must be provided for update", 400);
    }

    const col = await getCollection<WorkflowRunDocument>("workflow_runs");
    await col.updateOne({ _id: id }, { $set: body });

    return successResponse({ id, message: "Workflow run updated successfully" });
  });
});

// ═══════════════════════════════════════════════════════════════
// DELETE — Delete a run
// ═══════════════════════════════════════════════════════════════

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  if (STORAGE_TYPE !== "mongodb") {
    throw new ApiError("MongoDB is required for workflow runs", 503);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    throw new ApiError("Workflow run ID is required", 400);
  }

  return await withAuth(request, async (_req, user) => {
    const col = await getCollection<WorkflowRunDocument>("workflow_runs");

    // Load run to get workflow_config_id for file cleanup
    const run = await col.findOne({ _id: id });

    // Clean up GridFS files via backend
    if (run?.workflow_config_id) {
      try {
        const daUrl = process.env.DYNAMIC_AGENTS_URL || "http://localhost:8100";
        const fsNamespace = JSON.stringify([run.workflow_config_id, id, "filesystem"]);
        await fetch(
          `${daUrl}/api/v1/files/namespace?fs_namespace=${encodeURIComponent(fsNamespace)}`,
          {
            method: "DELETE",
            headers: {
              "X-User-Context": Buffer.from(JSON.stringify({
                email: user.email,
                name: user.name,
              })).toString("base64"),
            },
          },
        );
      } catch {
        // Best-effort file cleanup — don't block run deletion
      }
    }

    // Clean up stream events
    try {
      await deleteEventsByRun(id);
    } catch {
      // Best-effort event cleanup
    }

    // Delete the run document
    await col.deleteOne({ _id: id });

    return successResponse({ id, message: "Workflow run deleted successfully" });
  });
});
