/**
 * POST /api/workflow-runs/[id]/cancel — Cancel a running workflow
 */

import { NextRequest, NextResponse } from "next/server";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { getAuthFromBearerOrSession, ApiError, withErrorHandler } from "@/lib/api-middleware";
import { cancelWorkflowRun } from "@/lib/server/workflow-engine";

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is required", 503);
  }

  const { id } = await params;
  await getAuthFromBearerOrSession(request);

  await cancelWorkflowRun(id);

  return NextResponse.json({ status: "cancelled" }) as NextResponse;
});
