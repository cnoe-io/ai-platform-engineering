import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";

interface RouteContext {
  params: Promise<{ connection_id: string }>;
}

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const DELETE = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  assertFeatureEnabled();
  const { connection_id: connectionId } = await context.params;
  if (!connectionId?.trim()) {
    throw new ApiError("connection_id is required", 400, "VALIDATION_ERROR");
  }

  const { session } = await getAuthFromBearerOrSession(request);
  const ownerId = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!ownerId) {
    throw new ApiError("Authenticated subject is required", 401, "UNAUTHORIZED");
  }

  const service = await getProviderConnectionService();
  const revoked = await service.revokeConnection({
    connectionId,
    owner: { type: "user", id: ownerId },
  });
  return successResponse(revoked);
});
