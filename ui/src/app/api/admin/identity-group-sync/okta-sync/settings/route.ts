import { NextRequest, NextResponse } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { getOktaSyncSettings, upsertOktaSyncSettings } from "@/lib/rbac/okta-sync-store";

import { withIdentityGroupSyncAdminAuth } from "../../_lib";

const NOT_CONFIGURED = NextResponse.json(
  { success: false, error: "MongoDB not configured", code: "MONGODB_NOT_CONFIGURED" },
  { status: 503 }
);

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) return NOT_CONFIGURED;
  return withIdentityGroupSyncAdminAuth(request, async () => {
    const settings = await getOktaSyncSettings();
    return successResponse({ settings });
  });
});

export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) return NOT_CONFIGURED;
  return withIdentityGroupSyncAdminAuth(request, async () => {
    const body = (await request.json()) as {
      enabled?: boolean;
      group_filter?: string;
      user_filter?: string;
      sync_interval_minutes?: number;
      chunk_size?: number;
      updated_by?: string;
    };
    await upsertOktaSyncSettings({
      ...body,
      updated_at: new Date().toISOString(),
    });
    const settings = await getOktaSyncSettings();
    return successResponse({ settings });
  });
});
