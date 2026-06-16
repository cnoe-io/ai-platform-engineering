/**
 * POST /api/workflow-runs/[id]/cancel — Cancel a running workflow
 */

import { ApiError,withAuth,withErrorHandler } from "@/lib/api-middleware";
import { getCollection,isMongoDBConfigured } from "@/lib/mongodb";
import { requireWorkflowRunAccess } from "@/lib/server/workflow-cas-authz";
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

  return await withAuth(request, async (_req, _user, session) => {
    const runCol = await getCollection<WorkflowRunDocument>("workflow_runs");
    const run = await runCol.findOne({ _id: id });
    if (!run) {
      throw new ApiError("Workflow run not found", 404);
    }

    await requireWorkflowRunAccess(session, run, "cancel");

    await cancelWorkflowRun(id);

    return NextResponse.json({ status: "cancelled" }) as NextResponse;
  });
});
