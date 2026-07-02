import { NextRequest,NextResponse } from "next/server";

import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import {
isConnectorConfigured,
listIdpConnectors,
} from "@/lib/rbac/idp-connectors";
import { getIdpSyncSettings,listIdpSyncRuns,reapStaleIdpSyncRuns } from "@/lib/rbac/idp-sync-store";

import { withIdentityGroupSyncViewAuth } from "../../_lib";
import { resolveProviderParam } from "../_provider";

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: "MongoDB not configured", code: "MONGODB_NOT_CONFIGURED" },
      { status: 503 }
    );
  }
  return withIdentityGroupSyncViewAuth(request, async () => {
    const provider = resolveProviderParam(request);
    const configured = isConnectorConfigured(provider);
    // Reap dead `running` rows (interrupted by a pod/process restart) before
    // reading, so the UI reflects them as failed rather than stuck "running".
    await reapStaleIdpSyncRuns(provider, Date.now());
    const [settings, recentRuns] = await Promise.all([
      getIdpSyncSettings(provider),
      listIdpSyncRuns(provider, 20),
    ]);

    return successResponse({
      provider,
      connectors: listIdpConnectors(),
      settings,
      recent_runs: recentRuns,
      provider_configured: configured,
    });
  });
});
