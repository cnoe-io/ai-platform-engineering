import { NextRequest } from "next/server";

import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import { getMigrationBlockingStatus } from "@/lib/rbac/migrations/registry";

import { requireMigrationSuperAdmin } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user } = await requireMigrationSuperAdmin(request);
  return successResponse(await getMigrationBlockingStatus({ actor: user.email }));
});
