import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getCredentialSecretService } from "@/lib/credentials/secret-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { requireAdminSurfaceManage } from "@/lib/rbac/require-openfga";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, "credentials");
  const service = await getCredentialSecretService();
  return successResponse(await service.listAllSecretsForAdmin());
});
