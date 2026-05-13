import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { listRebacCatalog } from "@/lib/rbac/resource-catalog";

import { withRebacViewAuth } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withRebacViewAuth(request, async () => {
    const url = new URL(request.url);
    const catalog = await listRebacCatalog({
      type: url.searchParams.get("type"),
      status: url.searchParams.get("status"),
      search: url.searchParams.get("search"),
    });
    return successResponse(catalog);
  })
);
