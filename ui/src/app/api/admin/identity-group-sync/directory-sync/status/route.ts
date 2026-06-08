import { NextRequest, NextResponse } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import {
  checkConnectorHealthForProvider,
  isConnectorConfigured,
  listIdpConnectors,
  type IdpConnectorHealth,
} from "@/lib/rbac/idp-connectors";
import { getIdpSyncSettings, listIdpSyncRuns } from "@/lib/rbac/idp-sync-store";

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
    const [settings, recentRuns] = await Promise.all([
      getIdpSyncSettings(provider),
      listIdpSyncRuns(provider, 20),
    ]);

    // One-shot credential probe so the page can flag bad creds up front.
    // Best-effort: never let the health check sink the whole status response.
    let health: IdpConnectorHealth | null = null;
    if (configured) {
      try {
        health = await checkConnectorHealthForProvider(provider);
      } catch (err) {
        health = {
          ok: false,
          mode: provider,
          error: err instanceof Error ? err.message : "Connectivity check failed.",
        };
      }
    }

    return successResponse({
      provider,
      connectors: listIdpConnectors(),
      settings,
      recent_runs: recentRuns,
      provider_configured: configured,
      health,
    });
  });
});
