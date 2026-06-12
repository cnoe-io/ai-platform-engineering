/**
 * POST /api/workflow-runs/[id]/resume — Resume a workflow run waiting for input
 */

import { ApiError,withAuth,withErrorHandler } from "@/lib/api-middleware";
import { getCollection,isMongoDBConfigured } from "@/lib/mongodb";
import { buildWorkflowDaAuthHeaders } from "@/lib/server/workflow-da-auth";
import { requireWorkflowRunAccess } from "@/lib/server/workflow-cas-authz";
import { resumeWorkflowRun,type WorkflowRunDocument } from "@/lib/server/workflow-engine";
import { NextRequest,NextResponse } from "next/server";

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is required", 503);
  }

  const { id } = await params;

  return await withAuth(request, async (req, user, session) => {
    const body = await req.json();
    const { step_index, resume_data } = body;

    if (step_index === undefined || resume_data === undefined) {
      throw new ApiError("step_index and resume_data are required", 400);
    }

    const runCol = await getCollection<WorkflowRunDocument>("workflow_runs");
    const run = await runCol.findOne({ _id: id });
    if (!run) {
      throw new ApiError("Workflow run not found", 404);
    }

    await requireWorkflowRunAccess(session, run, "resume");

    const authHeaders = buildWorkflowDaAuthHeaders(req, user, session);

    await resumeWorkflowRun(id, step_index, resume_data, authHeaders);

    return NextResponse.json({ status: "resumed" }) as NextResponse;
  });
});
