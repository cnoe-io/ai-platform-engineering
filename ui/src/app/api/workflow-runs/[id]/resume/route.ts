/**
 * POST /api/workflow-runs/[id]/resume — Resume a workflow run waiting for input
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { getAuthFromBearerOrSession, getUserTeamIds, ApiError, withErrorHandler } from "@/lib/api-middleware";
import { resumeWorkflowRun, type WorkflowRunDocument } from "@/lib/server/workflow-engine";
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
  const body = await request.json();
  const { step_index, resume_data } = body;

  if (step_index === undefined || resume_data === undefined) {
    throw new ApiError("step_index and resume_data are required", 400);
  }

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

  // Build auth headers
  const authHeaders: Record<string, string> = {};
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    authHeaders["Authorization"] = authHeader;
  }
  authHeaders["X-User-Context"] = Buffer.from(JSON.stringify({
    email: user.email,
    name: user.name,
  })).toString("base64");

  await resumeWorkflowRun(id, step_index, resume_data, authHeaders);

  return NextResponse.json({ status: "resumed" }) as NextResponse;
});
