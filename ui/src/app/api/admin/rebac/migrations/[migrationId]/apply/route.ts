import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { applyMigration } from "@/lib/rbac/migrations/registry";

import { requireMigrationAdmin } from "../../_lib";

export const POST = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ migrationId: string }> },
  ) => {
    const { user } = await requireMigrationAdmin(request);
    const { migrationId } = await params;
    const body = (await request.json().catch(() => ({}))) as { confirmation?: string };
    return successResponse(
      await applyMigration({
        migrationId,
        confirmation: body.confirmation ?? "",
        actor: user.email,
      }),
    );
  },
);
