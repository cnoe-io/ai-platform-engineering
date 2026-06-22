import { NextRequest,NextResponse,after } from "next/server";

import { getAuthFromBearerOrSession,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { createSyncRun,executeSyncRun } from "@/lib/rbac/idp-sync-runner";

import { withIdentityGroupSyncAdminAuth } from "../../_lib";
import { resolveProviderParam } from "../_provider";

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: "MongoDB not configured", code: "MONGODB_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  return withIdentityGroupSyncAdminAuth(request, async () => {
    const provider = resolveProviderParam(request);
    const { session } = await getAuthFromBearerOrSession(request);
    const actor = session?.user?.email ?? "api";

    const run = await createSyncRun({ provider, actor, triggeredBy: "manual" });
    if (run.status === "already_running") {
      return NextResponse.json(
        {
          success: false,
          error: "A sync is already running for this connector. Wait for it to finish.",
          code: "SYNC_ALREADY_RUNNING",
          run_id: run.runId,
        },
        { status: 409 }
      );
    }

    after(() => executeSyncRun(run.runId, provider, actor));

    // 202 Accepted: the sync was scheduled, not completed, by the time we reply.
    return successResponse({ run_id: run.runId, provider, status: "running" }, 202);
  });
});
