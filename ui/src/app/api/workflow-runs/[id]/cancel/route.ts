/**
 * POST /api/workflow-runs/[id]/cancel — Cancel a running workflow
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { getAuthFromBearerOrSession, getUserTeamIds, ApiError, withErrorHandler } from "@/lib/api-middleware";
import { cancelWorkflowRun, type WorkflowRunDocument } from "@/lib/server/workflow-engine";
import type { WorkflowConfig } from "@/types/workflow-config";

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is required", 503);
  }

  const { id } = await params;
  const { user } = await getAuthFromBearerOrSession(request);

  // Load run to check config access
  const runCol = await getCollection<WorkflowRunDocument>("workflow_runs");
  const run = await runCol.findOne({ _id: id });
  if (!run) {
    throw new ApiError("Workflow run not found", 404);
  }

  // Verify user has access to the parent workflow config
  if (user.role !== "admin") {
    const configCol = await getCollection<WorkflowConfig>("workflow_configs");
    const userTeamIds = await getUserTeamIds(user.email);
    const config = await configCol.findOne({
      _id: run.workflow_config_id,
      $or: [
        { owner_id: user.email },
        { visibility: "global" },
        ...(userTeamIds.length > 0
          ? [{ visibility: "team" as const, shared_with_teams: { $in: userTeamIds } }]
          : []),
      ],
    });
    if (!config) {
      throw new ApiError("Workflow run not found", 404);
    }
  }

  await cancelWorkflowRun(id);

  return NextResponse.json({ status: "cancelled" }) as NextResponse;
});
