import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { applySchemaVersionBootstrap } from "@/lib/rbac/migrations/registry";

import { requireMigrationAdmin } from "../../_lib";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user } = await requireMigrationAdmin(request);
  const body = (await request.json().catch(() => ({}))) as {
    schema_areas?: unknown;
    confirmation?: string;
  };
  return successResponse(
    await applySchemaVersionBootstrap({
      schemaAreas: body.schema_areas,
      confirmation: body.confirmation ?? "",
      actor: user.email,
    }),
  );
});
