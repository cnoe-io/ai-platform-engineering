import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCredentialSecretService } from "@/lib/credentials/secret-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";

interface RouteContext {
  params: Promise<{ secret_id: string }>;
}

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

async function secretIdFromContext(context: RouteContext): Promise<string> {
  const params = await context.params;
  const secretId = params.secret_id?.trim();
  if (!secretId) {
    throw new ApiError("secret_id is required", 400, "VALIDATION_ERROR");
  }
  return secretId;
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  assertFeatureEnabled();
  const secretId = await secretIdFromContext(context);
  const { session } = await getAuthFromBearerOrSession(request);
  const service = await getCredentialSecretService();
  const secret = await service.getSecretMetadata({ session, secretId });
  return successResponse(secret);
});

export const PATCH = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  assertFeatureEnabled();
  const secretId = await secretIdFromContext(context);
  const { session } = await getAuthFromBearerOrSession(request);
  const body = (await request.json()) as Record<string, unknown>;
  const action = body.action;
  const service = await getCredentialSecretService();

  if (action === "rotate") {
    const secret = await service.rotateSecret({
      session,
      secretId,
      plaintext: typeof body.value === "string" ? body.value : "",
    });
    return successResponse(secret);
  }

  if (action === "share") {
    await service.shareSecret({ session, secretId, teamId: String(body.teamId ?? "") });
    return successResponse({ id: secretId, shared: true });
  }

  if (action === "revoke") {
    await service.revokeSecretShare({ session, secretId, teamId: String(body.teamId ?? "") });
    return successResponse({ id: secretId, revoked: true });
  }

  throw new ApiError("Unsupported credential secret action", 400, "VALIDATION_ERROR");
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  assertFeatureEnabled();
  const secretId = await secretIdFromContext(context);
  const { session } = await getAuthFromBearerOrSession(request);
  const service = await getCredentialSecretService();
  await service.deleteSecret({ session, secretId });
  return successResponse({ id: secretId, deleted: true });
});
