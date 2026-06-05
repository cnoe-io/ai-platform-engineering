/**
 * POST /api/workflow-runs/[id]/cancel — Cancel a running workflow
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { getAuthFromBearerOrSession, ApiError, withErrorHandler } from "@/lib/api-middleware";
import { cancelWorkflowRun, type WorkflowRunDocument } from "@/lib/server/workflow-engine";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is required", 503);
  }

  const { id } = await params;
  const { session } = await getAuthFromBearerOrSession(request);

  // Load run to check config access
  const runCol = await getCollection<WorkflowRunDocument>("workflow_runs");
  const run = await runCol.findOne({ _id: id });
  if (!run) {
    throw new ApiError("Workflow run not found", 404);
  }

  await requireResourcePermission(
    session,
    { type: "task", id: run.workflow_config_id, action: "write" },
    { allowAdminBypass: true },
  );

  await cancelWorkflowRun(id);

  return NextResponse.json({ status: "cancelled" }) as NextResponse;
});
