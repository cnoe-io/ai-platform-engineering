import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { listReleaseMigrations } from "@/lib/rbac/migrations/registry";

import { requireMigrationAdmin } from "./_lib";

export const GET = withErrorHandler(async (request: NextRequest) => {
  await requireMigrationAdmin(request);
  const includeCompleted = request.nextUrl.searchParams.get("include_completed") === "true";
  return successResponse(await listReleaseMigrations({ includeCompleted }));
});
