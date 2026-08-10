import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getCredentialRetrievalService } from "@/lib/credentials/retrieval-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  const body = (await request.json()) as Record<string, unknown>;
  const service = await getCredentialRetrievalService();
  const result = await service.retrieve({
    headers: request.headers,
    body,
    session,
  });

  return successResponse(result);
});
