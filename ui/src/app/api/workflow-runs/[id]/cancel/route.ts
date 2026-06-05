/**
 * POST /api/workflow-runs/[id]/cancel — Cancel a running workflow
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { ApiError, withAuth, withErrorHandler } from "@/lib/api-middleware";
import { cancelWorkflowRun, type WorkflowRunDocument } from "@/lib/server/workflow-engine";
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

  return await withAuth(request, async (_req, user, session) => {
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

    await cancelWorkflowRun(id);

    return NextResponse.json({ status: "cancelled" }) as NextResponse;
  });
});
