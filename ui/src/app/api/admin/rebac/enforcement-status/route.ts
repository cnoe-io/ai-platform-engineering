import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { listRebacEnforcementStatuses } from "@/lib/rbac/enforcement-status";

import { withRebacViewAuth } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withRebacViewAuth(request, async () => {
    const statuses = await listRebacEnforcementStatuses();
    return successResponse({ statuses, total: statuses.length });
  })
);
