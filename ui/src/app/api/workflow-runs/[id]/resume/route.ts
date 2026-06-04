/**
 * POST /api/workflow-runs/[id]/resume — Resume a workflow run waiting for input
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { getAuthFromBearerOrSession, ApiError, withErrorHandler } from "@/lib/api-middleware";
import { resumeWorkflowRun, type WorkflowRunDocument } from "@/lib/server/workflow-engine";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is required", 503);
  }

  const { id } = await params;
  const { user, session } = await getAuthFromBearerOrSession(request);
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

  await requireResourcePermission(
    session,
    { type: "task", id: run.workflow_config_id, action: "write" },
    { bypassForOrgAdmin: true },
  );

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
