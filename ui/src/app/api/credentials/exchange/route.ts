import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { assertCredentialServiceCaller } from "@/lib/credentials/internal-caller";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  assertCredentialServiceCaller({
    headers: request.headers,
    expectedAudience: process.env.CREDENTIAL_SERVICE_AUDIENCE || "caipe-credential-service",
  });

  const body = (await request.json()) as Record<string, unknown>;
  const providerConnectionId =
    typeof body.provider_connection_id === "string" ? body.provider_connection_id.trim() : "";
  if (!providerConnectionId) {
    throw new ApiError("provider_connection_id is required", 400, "VALIDATION_ERROR");
  }

  const service = await getProviderConnectionService();
  const token = await service.refreshConnection(providerConnectionId);

  return successResponse({
    provider_connection_id: providerConnectionId,
    access_token: token.accessToken,
    expires_in: token.expiresIn,
  });
});
