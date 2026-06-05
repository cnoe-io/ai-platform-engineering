/**
 * POST /api/workflow-runs/[id]/resume — Resume a workflow run waiting for input
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { ApiError, withAuth, withErrorHandler } from "@/lib/api-middleware";
import { resumeWorkflowRun, type WorkflowRunDocument } from "@/lib/server/workflow-engine";
import { buildWorkflowDaAuthHeaders } from "@/lib/server/workflow-da-auth";
import {
  assertCanExecuteWorkflowRunsForConfigId,
} from "@/lib/rbac/workflow-run-access";
import { resolveUserTeamSlugsForWorkflow } from "@/lib/rbac/workflow-config-rebac";

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

    const userTeamSlugs = await resolveUserTeamSlugsForWorkflow(user.email, session);
    await assertCanExecuteWorkflowRunsForConfigId(
      session,
      run.workflow_config_id,
      user.email,
      userTeamSlugs,
    );

    const authHeaders = buildWorkflowDaAuthHeaders(req, user, session);

    await resumeWorkflowRun(id, step_index, resume_data, authHeaders);

    return NextResponse.json({ status: "resumed" }) as NextResponse;
  });
});
