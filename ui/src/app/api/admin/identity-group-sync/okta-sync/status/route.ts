import { NextRequest, NextResponse } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { getOktaSyncSettings, listOktaSyncRuns } from "@/lib/rbac/okta-sync-store";

import { withIdentityGroupSyncViewAuth } from "../../_lib";

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: "MongoDB not configured", code: "MONGODB_NOT_CONFIGURED" },
      { status: 503 }
    );
  }
  return withIdentityGroupSyncViewAuth(request, async () => {
    const [settings, recentRuns] = await Promise.all([
      getOktaSyncSettings(),
      listOktaSyncRuns(20),
    ]);
    const providerConfigured = !!(
      process.env.IDENTITY_SYNC_OKTA_ORG_URL?.trim() &&
      process.env.IDENTITY_SYNC_OKTA_API_TOKEN?.trim()
    );
    return successResponse({ settings, recent_runs: recentRuns, provider_configured: providerConfigured });
  });
});
