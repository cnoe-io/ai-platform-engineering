import { NextRequest, NextResponse } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { listIdpSyncRunsPage, reapStaleIdpSyncRuns } from "@/lib/rbac/idp-sync-store";

import { withIdentityGroupSyncViewAuth } from "../../_lib";
import { resolveProviderParam } from "../_provider";

// GET /api/admin/identity-group-sync/directory-sync/runs
// Paginated Sync History for one connector. Separate from `/status` so paging
// through history is cheap (no connector credential/health probe) and doesn't
// reset the settings form. Provider-scoped via `?provider=`, so any registered
// connector (Okta today, others later) shares this path with no extra code.
//
// Query params: `page` (1-based), `page_size` (1–100, default 20).
// Response: { runs, total, page, page_size, has_more }.
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: "MongoDB not configured", code: "MONGODB_NOT_CONFIGURED" },
      { status: 503 }
    );
  }
  return withIdentityGroupSyncViewAuth(request, async () => {
    const provider = resolveProviderParam(request);
    // Reap dead `running` rows before reading so a row interrupted by a
    // pod/process restart shows as failed rather than stuck "running" — same
    // guarantee the `/status` route gives the summary cards.
    await reapStaleIdpSyncRuns(provider, Date.now());

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const pageSizeRaw = parseInt(url.searchParams.get("page_size") || "20", 10) || 20;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));

    const { runs, total } = await listIdpSyncRunsPage(provider, { page, pageSize });

    return successResponse({
      provider,
      runs,
      total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < total,
    });
  });
});
