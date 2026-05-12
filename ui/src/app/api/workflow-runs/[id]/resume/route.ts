/**
 * POST /api/workflow-runs/[id]/resume — Resume a workflow run waiting for input
 */

import { NextRequest, NextResponse } from "next/server";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { getAuthFromBearerOrSession, ApiError, withErrorHandler } from "@/lib/api-middleware";
import { resumeWorkflowRun } from "@/lib/server/workflow-engine";

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
