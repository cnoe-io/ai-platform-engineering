import { NextRequest, NextResponse } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { isValidCron } from "@/lib/rbac/cron";
import { getIdpSyncSettings, upsertIdpSyncSettings } from "@/lib/rbac/idp-sync-store";

import { withIdentityGroupSyncAdminAuth } from "../../_lib";
import { resolveProviderParam } from "../_provider";

const NOT_CONFIGURED = NextResponse.json(
  { success: false, error: "MongoDB not configured", code: "MONGODB_NOT_CONFIGURED" },
  { status: 503 }
);

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) return NOT_CONFIGURED;
  return withIdentityGroupSyncAdminAuth(request, async () => {
    const provider = resolveProviderParam(request);
    const settings = await getIdpSyncSettings(provider);
    return successResponse({ settings });
  });
});

export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) return NOT_CONFIGURED;
  return withIdentityGroupSyncAdminAuth(request, async () => {
    const provider = resolveProviderParam(request);
    const body = (await request.json()) as {
      enabled?: boolean;
      group_filter?: string;
      user_filter?: string;
      schedule_mode?: "interval" | "cron";
      sync_interval_minutes?: number;
      sync_cron?: string;
      updated_by?: string;
    };

    // When scheduling by cron, the expression must be a valid 5-field cron.
    if (body.schedule_mode === "cron" && !isValidCron(body.sync_cron)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid cron expression. Expected 5 fields: minute hour day-of-month month day-of-week.",
          code: "INVALID_CRON",
        },
        { status: 400 }
      );
    }

    await upsertIdpSyncSettings(provider, {
      ...body,
      updated_at: new Date().toISOString(),
    });
    const settings = await getIdpSyncSettings(provider);
    return successResponse({ settings });
  });
});
