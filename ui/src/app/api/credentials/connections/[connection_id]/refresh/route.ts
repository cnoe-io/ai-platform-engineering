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

export const POST = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
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
  const connection = await service.getConnection(connectionId);
  if (connection.owner.type !== "user" || connection.owner.id !== ownerId) {
    throw new ApiError("Provider connection was not found", 404, "CREDENTIAL_NOT_FOUND");
  }
  if (connection.status !== "connected") {
    throw new ApiError("Provider connection requires re-authentication", 401, "CREDENTIAL_REAUTH_REQUIRED");
  }

  const token = await service.refreshConnection(connection.id);
  return successResponse({
    id: connection.id,
    provider: connection.provider,
    ok: true,
    expires_in: token.expiresIn,
  });
});
