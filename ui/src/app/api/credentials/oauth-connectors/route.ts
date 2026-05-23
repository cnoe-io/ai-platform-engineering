import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getOAuthConnectorService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  await getAuthFromBearerOrSession(request);
  const service = await getOAuthConnectorService();
  const connectors = await service.listConnectors();
  return successResponse(
    connectors
      .filter((connector) => connector.enabled)
      .map((connector) => ({
        id: connector.id,
        name: connector.name,
        provider: connector.provider,
        enabled: connector.enabled,
      })),
  );
});
