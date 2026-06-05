import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getKeycloakMigrationHealth } from "@/lib/rbac/keycloak-migration-health";

import { requireMigrationAdmin } from "../../rebac/migrations/_lib";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user } = await requireMigrationAdmin(request);
  return successResponse(await getKeycloakMigrationHealth({ actor: user.email }));
});
