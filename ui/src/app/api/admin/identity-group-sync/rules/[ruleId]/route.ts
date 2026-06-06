import { NextRequest, NextResponse } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import {
  getIdentityGroupSyncRule,
  upsertIdentityGroupSyncRule,
} from "@/lib/rbac/identity-group-sync-rule-store";

import { withIdentityGroupSyncAdminAuth } from "../../_lib";

export const PATCH = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ ruleId: string }> }) => {
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
      const { ruleId } = await context.params;
      const existing = await getIdentityGroupSyncRule(ruleId);
      if (!existing) throw new ApiError("sync rule not found", 404);

      const body = await request.json();
      const updated = {
        ...existing,
        ...body,
        id: existing.id,
        provider_id: existing.provider_id,
        updated_at: new Date().toISOString(),
      };
      await upsertIdentityGroupSyncRule(updated);
      return successResponse({ rule: updated });
    });
  }
);
