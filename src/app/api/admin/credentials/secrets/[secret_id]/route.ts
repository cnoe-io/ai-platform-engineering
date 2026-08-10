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

async function adminCredentialService(request: NextRequest) {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, "credentials");
  return getCredentialSecretService();
}

export const PATCH = withErrorHandler(async (request: NextRequest, context?: { params: Promise<{ secret_id: string }> }) => {
  const { secret_id: secretId } = await context!.params;
  const body = (await request.json()) as Record<string, unknown>;
  const service = await adminCredentialService(request);
  return successResponse(
    await service.updateSecretMetadataForAdmin({
      secretId,
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
    }),
  );
});

export const DELETE = withErrorHandler(async (request: NextRequest, context?: { params: Promise<{ secret_id: string }> }) => {
  const { secret_id: secretId } = await context!.params;
  const service = await adminCredentialService(request);
  await service.deleteSecretForAdmin(secretId);
  return successResponse({ deleted: true });
});
