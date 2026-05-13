import { NextRequest, NextResponse } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";

import { withIdentityGroupSyncViewAuth } from "../../_lib";

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ runId: string }> }) => {
    if (!isMongoDBConfigured) {
      return NextResponse.json(
        {
          success: false,
          error: "MongoDB not configured - identity group sync requires MongoDB",
          code: "MONGODB_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    return withIdentityGroupSyncViewAuth(request, async () => {
      const { runId } = await context.params;
      const runs = await getRbacCollection("identityGroupSyncRuns");
      const run = await runs.findOne({ id: runId });
      if (!run) throw new ApiError("sync run not found", 404);
      return successResponse({ run });
    });
  }
);
