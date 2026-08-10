import { NextRequest } from "next/server";

// assisted-by Codex GPT-5.5

import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import { recordMigrationOverride } from "@/lib/rbac/migrations/registry";

import { requireMigrationSuperAdmin } from "../_lib";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user } = await requireMigrationSuperAdmin(request);
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  return successResponse(
    await recordMigrationOverride({
      actor: user.email,
      reason: body.reason ?? "",
    }),
  );
});
