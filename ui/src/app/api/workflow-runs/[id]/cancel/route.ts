/**
 * POST /api/workflow-runs/[id]/cancel — Cancel a running workflow
 */

import { ApiError,getAuthFromBearerOrSession,withErrorHandler } from "@/lib/api-middleware";
import { getCollection,isMongoDBConfigured } from "@/lib/mongodb";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { cancelWorkflowRun,type WorkflowRunDocument } from "@/lib/server/workflow-engine";
import { NextRequest,NextResponse } from "next/server";

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
    { bypassForOrgAdmin: true },
  );

  await cancelWorkflowRun(id);

  return NextResponse.json({ status: "cancelled" }) as NextResponse;
});
