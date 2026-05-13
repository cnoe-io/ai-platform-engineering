import { NextRequest, NextResponse } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";

import { withIdentityGroupSyncAdminAuth } from "../../../_lib";

export const POST = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ sourceId: string }> }) => {
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

    return withIdentityGroupSyncAdminAuth(request, async () => {
      const { sourceId } = await context.params;
      const body = await request.json().catch(() => ({}));
      const sources = await getRbacCollection("teamMembershipSources");
      await sources.updateOne(
        { id: sourceId },
        {
          $set: {
            status: "active",
            user_subject: body.user_subject,
            last_applied_at: new Date().toISOString(),
          },
        }
      );
      return successResponse({ source_id: sourceId, resolved: true });
    });
  }
);
