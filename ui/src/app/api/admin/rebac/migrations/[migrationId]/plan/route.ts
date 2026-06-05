import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { planMigration } from "@/lib/rbac/migrations/registry";

import { requireMigrationAdmin } from "../../_lib";

export const POST = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ migrationId: string }> },
  ) => {
    await requireMigrationAdmin(request);
    const { migrationId } = await params;
    return successResponse(await planMigration(migrationId));
  },
);
