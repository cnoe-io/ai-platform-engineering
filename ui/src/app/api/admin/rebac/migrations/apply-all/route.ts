import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { applyAllMigrations } from "@/lib/rbac/migrations/registry";

import { requireMigrationAdmin } from "../_lib";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user } = await requireMigrationAdmin(request);
  const body = (await request.json().catch(() => ({}))) as { confirmation?: string };
  return successResponse(
    await applyAllMigrations({
      actor: user.email,
      confirmation: body.confirmation ?? "",
    }),
  );
});
