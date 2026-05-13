import { NextRequest, NextResponse } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { listTeamMembershipSources } from "@/lib/rbac/team-membership-source-store";

import { withIdentityGroupSyncViewAuth } from "../../../_lib";

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ teamId: string }> }) => {
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
      const { teamId } = await context.params;
      const sources = await listTeamMembershipSources(teamId);
      return successResponse({ sources, total: sources.length });
    });
  }
);
