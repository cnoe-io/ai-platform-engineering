import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getMigrationBlockingStatus } from "@/lib/rbac/migrations/registry";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user } = await getAuthFromBearerOrSession(request);
  return successResponse(await getMigrationBlockingStatus({ actor: user.email }));
});
